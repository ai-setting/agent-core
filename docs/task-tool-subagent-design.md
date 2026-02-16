# TaskTool & SubAgent 设计方案

> 本文档描述 agent-core 中 TaskTool 和 SubAgent 的实现设计，参考 OpenCode 和 OpenClaw 的设计经验，结合 agent-core 现有的 Environment 和事件机制。

## 1. 概述

### 1.1 目标

实现一个 TaskTool，允许主 Agent（Primary Agent）将复杂任务委派给子代理（SubAgent）执行：

1. **TaskTool**：作为 Environment 中的工具，供 Agent 调用
2. **SubAgent**：基于 Session 机制创建的子会话，拥有独立的执行上下文
3. **后台执行**：通过 `background` 参数支持异步后台任务
4. **事件通知**：后台任务完成后通过 EnvEvent 机制通知主 Session 继续执行

### 1.2 参考实现对比

| 特性 | OpenCode TaskTool | OpenClaw sessions_spawn | 本设计 |
|------|-------------------|-------------------------|--------|
| 委派方式 | 同步等待结果 | 异步后台执行 | 支持两种模式 |
| Session 关联 | parentID 链式关联 | Session Key 编码 | parentID 链式关联 |
| 结果返回 | 直接返回结果 | Announce 回调推送 | 后台模式：事件推送 |
| 权限控制 | PermissionNext 规则 | allowAgents 白名单 | 基于 Environment 权限 |
| 子 Agent 创建子 Agent | 未明确限制 | 明确禁止 | 禁止（安全） |

---

## 2. 架构设计

### 2.1 核心组件

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ServerEnvironment                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐ │
│  │  TaskTool       │  │  SubAgent       │  │  EnvEvent Bus              │ │
│  │  (Tool)         │  │  Manager        │  │  (Event Processing)        │ │
│  └────────┬────────┘  └────────┬────────┘  └──────────────┬──────────────┘ │
│           │                    │                           │                │
│           ▼                    ▼                           ▼                │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                     SubAgent Session                                 │  │
│  │  - parentID: 指向主 Session                                          │  │
│  │  - 独立的工具权限（受限）                                             │  │
│  │  - 独立的执行上下文                                                   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

#### 同步模式（非 background）

```
Primary Agent
    │
    ▼
TaskTool.execute()
    │
    ├── 创建 SubAgent Session (parentID = 主Session)
    │
    ├── 调用 Session.handle_query() 执行任务
    │
    ├── 等待结果返回
    │
    ▼
返回结果给 Primary Agent
```

#### 后台模式（background=true）

```
Primary Agent
    │
    ▼
TaskTool.execute(background=true)
    │
    ├── 创建 SubAgent Session
    │
    ├── 立即返回："后台任务已开始执行..."
    │   └── 包含 sub_session_id 供后续查询
    │
    ├── 后台启动异步执行
    │
    ├── SubAgent Session 执行完成
    │
    ▼
发布 background_task.completed 事件
    │
    ├── trigger_session_id = 主Session ID
    │
    ├── payload = { sub_session_id, result, ... }
    │
    ▼
EnvEvent Bus 处理事件
    │
    ├── 匹配 background_task.* 规则
    │
    ├── 通过 EventProcessor 在主 Session 插入事件消息
    │
    ├── 触发主 Agent 继续执行 (handle_query)
    │
    ▼
Primary Agent 继续处理
```

---

## 3. TaskTool 设计

### 3.1 参数定义

```typescript
// packages/core/src/core/environment/expend/task/task-tool.ts

const TaskToolParameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string()
    .describe("The type of subagent to use for this task (e.g., 'general', 'explore')")
    .default("general"),
  background: z.boolean()
    .describe("Whether to run the task in background (default: false)")
    .default(false),
  session_id: z.string()
    .describe("Existing session to continue (optional)")
    .optional(),
  command: z.string()
    .describe("The command that triggered this task (optional)")
    .optional(),
  timeout: z.number()
    .describe("Task timeout in milliseconds (optional)")
    .optional(),
  cleanup: z.enum(["delete", "keep"] as const)
    .describe("Whether to delete sub session after completion (default: keep)")
    .default("keep")
    .optional(),
});
```

### 3.2 返回值

```typescript
interface TaskToolResult {
  success: boolean;
  title: string;                    // 任务描述
  output: string;                   // 执行结果文本
  metadata: {
    sessionId: string;               // SubAgent Session ID
    subagent_type: string;
    background: boolean;
    execution_time_ms?: number;      // 同步模式执行时间
    // 后台模式特有
    status?: "accepted" | "completed" | "failed";
    sub_session_id?: string;         // 冗余，返回给前端参考
  };
}
```

### 3.3 立即返回消息（后台模式）

当 `background=true` 时，Tool 立即返回：

```
"Background task accepted: {description}

A sub-agent session ({sub_session_id}) has been created and is running in the background. You will be notified when the task completes.

Session ID: {sub_session_id}
SubAgent Type: {subagent_type}"

<task_metadata>
session_id: {sub_session_id}
status: accepted
</task_metadata>
```

---

## 4. SubAgent 实现

### 4.1 SubAgent 类型定义

```typescript
// packages/core/src/core/types/agent.ts

export interface SubAgentSpec {
  id: string;                       // 唯一标识 (如 "general", "explore")
  name: string;                     // 显示名称
  description: string;             // 描述（用于 Tool description）
  mode: "subagent" | "primary" | "all";
  promptOverride?: string;          // 可选的 prompt 覆盖
  allowedTools?: string[];          // 工具白名单
  deniedTools?: string[];           // 工具黑名单
  maxRetries?: number;              // 最大重试次数
  timeout?: number;                 // 超时时间（毫秒）
}
```

### 4.2 内置 SubAgent

参考 OpenCode，内置两种 SubAgent：

```typescript
// packages/core/src/core/environment/expend/task/agents.ts

export const builtInSubAgents: SubAgentSpec[] = [
  {
    id: "general",
    name: "general",
    mode: "subagent",
    description: "General-purpose agent for researching complex questions and executing multi-step tasks.",
    promptOverride: `You are a subagent created by the main agent to handle a specific task.

## Your Role
- You were created to handle: {task_description}
- Complete this task. That's your entire purpose.
- You are NOT the main agent. Don't try to be.

## Rules
1. **Stay focused** - Do your assigned task, nothing else
2. **Complete the task** - Your final message will be automatically reported to the main agent
3. **Don't initiate** - No heartbeats, no proactive actions, no side quests
4. **Be ephemeral** - You may be terminated after task completion. That's fine.

## Execution
- Use the available tools to complete the task
- If you need more information, ask the main agent through the result
- Return a clear summary of what you did and the results`,
  },
  {
    id: "explore",
    name: "explore",
    mode: "subagent",
    description: "Fast agent specialized for exploring codebases, finding files, and searching for patterns.",
  },
];
```

### 4.3 SubAgent Session 创建

```typescript
// packages/core/src/core/environment/expend/task/subagent-manager.ts

export class SubAgentManager {
  constructor(private env: ServerEnvironment) {}

  /**
   * 创建 SubAgent Session
   */
  async createSubSession(
    parentSessionId: string,
    options: {
      title: string;
      subagentType: string;
      prompt?: string;
      permission?: SessionPermission[];
    }
  ): Promise<Session> {
    const parentSession = this.env.getSession(parentSessionId);
    if (!parentSession) {
      throw new Error(`Parent session not found: ${parentSessionId}`);
    }

    // 构建子 Session 权限（继承父 Session 但限制工具）
    const subAgent = this.getSubAgentSpec(options.subagentType);
    const permissions = this.buildSubAgentPermissions(
      parentSession,
      subAgent,
      options.permission
    );

    // 创建子 Session
    const subSession = this.env.createSession({
      parentID: parentSessionId,
      title: options.title,
      metadata: {
        subagent_type: options.subagentType,
        created_by: "subagent",
        permissions,
      },
    });

    // 添加系统提示
    const systemPrompt = options.prompt || subAgent?.promptOverride || this.getDefaultPrompt(options.title);
    subSession.addMessage({
      id: `sys_${Date.now()}`,
      sessionID: subSession.id,
      role: "system",
      timestamp: Date.now(),
    }, [{ type: "text", text: systemPrompt }]);

    return subSession;
  }

  /**
   * 构建子 Agent 权限
   * - 默认禁止 todowrite/todoread（安全）
   * - 根据 subagent 规范限制工具列表
   */
  private buildSubAgentPermissions(
    parentSession: Session,
    subAgent: SubAgentSpec | undefined,
    extraPermissions?: SessionPermission[]
  ): SessionPermission[] {
    const permissions: SessionPermission[] = [
      // 默认禁止写入/读取 todo（全系统安全考虑）
      { permission: "todowrite", pattern: "*", action: "deny" },
      { permission: "todoread", pattern: "*", action: "deny" },
      // 禁止创建子 Agent（安全）
      { permission: "task", pattern: "*", action: "deny" },
    ];

    // 如果 subagent 有工具限制，应用白名单/黑名单
    if (subAgent?.allowedTools) {
      // 白名单模式：先拒绝所有，再允许指定的
      permissions.push({ permission: "*", pattern: "*", action: "deny" });
      for (const tool of subAgent.allowedTools) {
        permissions.push({ permission: "tool", pattern: tool, action: "allow" });
      }
    }

    if (subAgent?.deniedTools) {
      for (const tool of subAgent.deniedTools) {
        permissions.push({ permission: "tool", pattern: tool, action: "deny" });
      }
    }

    return [...permissions, ...(extraPermissions || [])];
  }
}
```

---

## 5. 后台任务执行

### 5.1 后台任务管理器

```typescript
// packages/core/src/core/environment/expend/task/background-task-manager.ts

export interface BackgroundTask {
  id: string;
  subSessionId: string;
  parentSessionId: string;
  description: string;
  subagentType: string;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

export class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTask> = new Map();

  /**
   * 创建后台任务
   */
  async createTask(
    env: ServerEnvironment,
    parentSessionId: string,
    options: {
      description: string;
      prompt: string;
      subagentType: string;
      timeout?: number;
      cleanup?: "delete" | "keep";
    }
  ): Promise<{ taskId: string; subSessionId: string }> {
    const taskId = `task_${crypto.randomUUID()}`;
    const subSessionId = `sub_${crypto.randomUUID()}`;

    // 创建 SubAgent Session
    const subSession = await this.createSubSession(env, parentSessionId, {
      sessionId: subSessionId,
      description: options.description,
      subagentType: options.subagentType,
      prompt: options.prompt,
    });

    // 记录任务
    const task: BackgroundTask = {
      id: taskId,
      subSessionId: subSession.id,
      parentSessionId,
      description: options.description,
      subagentType: options.subagentType,
      status: "pending",
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, task);

    // 异步执行
    this.executeTask(env, taskId, options.timeout, options.cleanup);

    return { taskId, subSessionId: subSession.id };
  }

  /**
   * 异步执行任务
   */
  private async executeTask(
    env: ServerEnvironment,
    taskId: string,
    timeout?: number,
    cleanup?: "delete" | "keep"
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "running";
    task.startedAt = Date.now();

    try {
      // 获取 SubAgent Session
      const subSession = env.getSession(task.subSessionId);
      if (!subSession) {
        throw new Error(`Sub session not found: ${task.subSessionId}`);
      }

      // 执行任务（带超时）
      const result = await this.executeWithTimeout(
        env,
        subSession,
        task.prompt,
        timeout || 300000 // 默认 5 分钟
      );

      task.status = "completed";
      task.completedAt = Date.now();
      task.result = result;

      // 发布完成事件
      await this.publishCompletionEvent(env, task);

    } catch (error) {
      task.status = "failed";
      task.completedAt = Date.now();
      task.error = error instanceof Error ? error.message : String(error);

      // 发布失败事件
      await this.publishFailureEvent(env, task);
    } finally {
      // 清理（如果配置删除）
      if (cleanup === "delete") {
        env.deleteSession(task.subSessionId);
        this.tasks.delete(taskId);
      }
    }
  }

  /**
   * 发布任务完成事件
   */
  private async publishCompletionEvent(
    env: ServerEnvironment,
    task: BackgroundTask
  ): Promise<void> {
    await env.publishEvent({
      id: crypto.randomUUID(),
      type: EventTypes.BACKGROUND_TASK_COMPLETED,
      timestamp: Date.now(),
      metadata: {
        trigger_session_id: task.parentSessionId,
        source: "tool",
        task_id: task.id,
      },
      payload: {
        taskId: task.id,
        sub_session_id: task.subSessionId,
        description: task.description,
        subagentType: task.subagentType,
        result: task.result,
        execution_time_ms: task.completedAt! - task.startedAt!,
      },
    });
  }

  /**
   * 获取任务状态
   */
  getTask(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 列出所有任务
   */
  listTasks(parentSessionId?: string): BackgroundTask[] {
    const allTasks = Array.from(this.tasks.values());
    if (parentSessionId) {
      return allTasks.filter(t => t.parentSessionId === parentSessionId);
    }
    return allTasks;
  }
}
```

---

## 6. 事件机制集成

### 6.1 事件类型

在 `core/types/event.ts` 中添加：

```typescript
export const EventTypes = {
  // ... 现有事件

  // SubAgent 相关事件
  SUBAGENT_CREATED: "subagent.created",
  SUBAGENT_COMPLETED: "subagent.completed",
  SUBAGENT_FAILED: "subagent.failed",

  // 后台任务事件（可进一步细化）
  BACKGROUND_TASK_STARTED: "background_task.started",
  BACKGROUND_TASK_PROGRESS: "background_task.progress",
  // BACKGROUND_TASK_COMPLETED 已存在
  BACKGROUND_TASK_FAILED: "background_task.failed",
} as const;
```

### 6.2 EventBus 规则配置

在 `ServerEnvironment.initEventRules()` 中添加：

```typescript
// 后台任务完成事件
bus.registerRule({
  eventType: EventTypes.BACKGROUND_TASK_COMPLETED,
  handler: {
    type: "function",
    fn: async (event: EnvEvent) => {
      const { processEventInSession } = await import("../../core/event-processor.js");
      await processEventInSession(this, event, {
        prompt: `A background task has completed.

Task Description: {payload.description}
SubAgent Type: {payload.subagentType}
Execution Time: {payload.execution_time_ms}ms

Result:
{payload.result}

Analyze this result and decide how to proceed:
1. If the task is complete, summarize the results for the user
2. If there are errors, consider how to handle them
3. If more work is needed, continue with the next steps`,
      });
    }
  },
  options: { priority: 80 }
});

// 后台任务失败事件
bus.registerRule({
  eventType: EventTypes.BACKGROUND_TASK_FAILED,
  handler: {
    type: "function",
    fn: async (event: EnvEvent) => {
      const { processEventInSession } = await import("../../core/event-processor.js");
      await processEventInSession(this, event, {
        prompt: `A background task has failed.

Task Description: {payload.description}
Error: {payload.error}

Analyze this failure and decide how to proceed:
1. If the error is recoverable, consider retrying or using a different approach
2. If not, inform the user about the failure and potential next steps`,
      });
    }
  },
  options: { priority: 80 }
});
```

---

## 7. 文件结构

```
packages/core/src/core/environment/expend/task/
├── index.ts                          # 导出入口
├── task-tool.ts                      # TaskTool 定义
├── types.ts                          # 类型定义
├── subagent-manager.ts               # SubAgent 管理器
├── background-task-manager.ts        # 后台任务管理器
├── agents.ts                         # 内置 SubAgent 规范
└── permissions.ts                    # 权限构建工具
```

---

## 8. 实现计划

### Phase 1: 基础功能

- [ ] 创建 `task-tool.ts`，实现 TaskTool
- [ ] 实现 `SubAgentManager`，支持创建 SubAgent Session
- [ ] 实现内置 SubAgent 规范（general, explore）
- [ ] 注册 TaskTool 到 ServerEnvironment

### Phase 2: 后台任务

- [ ] 实现 `BackgroundTaskManager`
- [ ] 支持 `background=true` 参数
- [ ] 实现立即返回机制

### Phase 3: 事件集成

- [ ] 添加 SubAgent 相关事件类型
- [ ] 配置 EventBus 规则
- [ ] 集成 EventProcessor

### Phase 4: 完善与测试

- [ ] 权限控制（禁止子 Agent 再创建子 Agent）
- [ ] 超时处理
- [ ] 清理策略
- [ ] 单元测试与集成测试

---

## 9. 验收标准

### 9.1 同步模式

- [ ] Agent 调用 TaskTool 时任务同步执行
- [ ] 执行结果直接返回给 Agent
- [ ] SubAgent Session 正确创建（parentID 关联）

### 9.2 后台模式

- [ ] `background=true` 时 Tool 立即返回
- [ ] 后台任务独立运行，不阻塞主 Agent
- [ ] 任务完成后发布 `background_task.completed` 事件
- [ ] 主 Session 收到事件后继续执行

### 9.3 安全性

- [ ] 子 Agent 默认禁止 todowrite/todoread
- [ ] 子 Agent 禁止创建子 Agent（防止嵌套）
- [ ] 权限可配置（白名单/黑名单）

### 9.4 可观测性

- [ ] 任务执行事件通过 SSE 推送
- [ ] 日志记录任务创建/执行/完成
- [ ] 支持查询任务状态

---

## 10. 相关文档

- [Environment 设计理念](../environment-design-philosophy.md)
- [Environment 事件机制](../environment-event-mechanism.md)
- [OpenCode vs OpenClaw 子Agent对比分析](../opencode_openclaw_task_subagent_comparison.md)
