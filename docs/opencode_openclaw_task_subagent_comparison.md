# OpenCode 与 OpenClaw 子Agent委派机制设计实现详细对比分析

> **根目录绝对地址**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty`
>
> 其他Agent可通过拼接 `[根目录绝对地址] + [文档中的相对路径]` 获取完整绝对路径
> - 示例: 文档中写 `packages/opencode/src/tool/task.ts` → 完整路径: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\packages\opencode\src\tool\task.ts`

## 目录
1. [概述](#1-概述)
2. [OpenCode TaskTool 实现机制](#2-opencode-tasktool-实现机制)
3. [OpenClaw sessions_spawn 实现机制](#3-openclaw-sessions_spawn-实现机制)
4. [核心代码文件对照](#4-核心代码文件对照)
5. [设计理念对比](#5-设计理念对比)
6. [关键差异分析](#6-关键差异分析)
7. [总结](#7-总结)

---

## 1. 概述

本文档详细分析了两个开源AI编程助手（OpenCode 和 OpenClaw）在委托子Agent处理任务方面的实现机制。这两个系统都采用了类似的核心理念——主Agent可以委派任务给专门的子Agent，但它们在具体实现上存在显著差异。

### 1.1 项目基本信息

| 特性 | OpenCode | OpenClaw |
|------|----------|----------|
| 仓库地址 | github.com/anomalyco/opencode | github.com/openclaw/openclaw |
| 核心工具名称 | `TaskTool` | `sessions_spawn` |
| 编程语言 | TypeScript (Bun runtime) | TypeScript (Node.js) |
| 子Agent标识 | Session创建于主Session之下 | Session Key格式: `agent:<id>:subagent:<uuid>` |

---

## 2. OpenCode TaskTool 实现机制

### 2.1 核心文件位置

> **根目录**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty`

**完整绝对路径：**
- 核心实现: `opencode/packages/opencode/src/tool/task.ts`
- Agent定义: `opencode/packages/opencode/src/agent/agent.ts`
- Session处理: `opencode/packages/opencode/src/session/prompt.ts`

> **拼接示例**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\tool\task.ts`

### 2.2 TaskTool 参数定义

```typescript
// 文件: task.ts (第15-21行)
const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  session_id: z.string().describe("Existing Task session to continue").optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})
```

### 2.3 TaskTool 核心执行流程

```typescript
// 文件: task.ts (第41-191行)
// 核心execute函数执行以下步骤：

// 步骤1: 获取可访问的Agent列表并过滤权限
const agents = await Agent.list().then((x) => x.filter((a) => a.mode !== "primary"))
const caller = ctx?.agent
const accessibleAgents = caller
  ? agents.filter((a) => PermissionNext.evaluate("task", a.name, caller.permission).action !== "deny")
  : agents

// 步骤2: 权限检查
if (!ctx.extra?.bypassAgentCheck) {
  await ctx.ask({
    permission: "task",
    patterns: [params.subagent_type],
    always: ["*"],
    metadata: { description: params.description, subagent_type: params.subagent_type },
  })
}

// 步骤3: 获取目标Agent
const agent = await Agent.get(params.subagent_type)
if (!agent) throw new Error(`Unknown agent type: ${params.subagent_type}`)

// 步骤4: 创建新的子Session
const session = await Session.create({
  parentID: ctx.sessionID,
  title: params.description + ` (@${agent.name} subagent)`,
  permission: [
    { permission: "todowrite", pattern: "*", action: "deny" },
    { permission: "todoread", pattern: "*", action: "deny" },
    ...(hasTaskPermission ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
  ],
})

// 步骤5: 调用SessionPrompt.prompt启动子Agent执行
const result = await SessionPrompt.prompt({
  messageID,
  sessionID: session.id,
  model: { modelID: model.modelID, providerID: model.providerID },
  agent: agent.name,
  tools: { todowrite: false, todoread: false, ... },
  parts: promptParts,
})

// 步骤6: 返回结果
return {
  title: params.description,
  metadata: { summary, sessionId: session.id, model },
  output: text + "\n\n" + ["<task_metadata>", `session_id: ${session.id}`, "</task_metadata>"].join("\n"),
}
```

### 2.4 Agent定义与分类

```typescript
// 文件: agent.ts (第76-155行)
// OpenCode内置三种Agent模式：
export const Info = z.object({
  name: z.string(),
  mode: z.enum(["subagent", "primary", "all"]),  // 关键字段
  // ...
})

// 内置Agent定义示例
build: {
  name: "build",
  mode: "primary",  // 主Agent
  description: "The default agent. Executes tools based on configured permissions.",
},
explore: {
  name: "explore",
  mode: "subagent",  // 子Agent
  description: "Fast agent specialized for exploring codebases...",
},
general: {
  name: "general",
  mode: "subagent",  // 子Agent
  description: "General-purpose agent for researching complex questions...",
}
```

### 2.5 Session关联机制

OpenCode通过 `parentID` 建立主从Session关系，子Session继承主Session的上下文，但拥有独立的工具权限控制。

### 2.6 OpenCode的设计特点

1. **轻量级委派**: 使用简单的Session创建和权限继承
2. **权限过滤**: 基于PermissionNext进行细粒度的工具权限控制
3. **内置Agent**: 预定义`explore`和`general`两种子Agent
4. **结果返回**: 通过Task metadata格式返回session_id，便于追踪

---

## 3. OpenClaw sessions_spawn 实现机制

### 3.1 核心文件位置

> **根目录**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty`

**完整绝对路径：**
- 工具实现: `openclaw/src/agents/tools/sessions-spawn-tool.ts`
- 子Agent注册: `openclaw/src/agents/subagent-registry.ts`
- 结果通知: `openclaw/src/agents/subagent-announce.ts`

> **拼接示例**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\openclaw\src\agents\tools\sessions-spawn-tool.ts`

### 3.2 sessions_spawn 参数定义

```typescript
// 文件: sessions-spawn-tool.ts (第26-36行)
const SessionsSpawnToolSchema = Type.Object({
  task: Type.String(),
  label: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  thinking: Type.Optional(Type.String()),
  runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0 })),
  cleanup: optionalStringEnum(["delete", "keep"] as const),
})
```

### 3.3 sessions_spawn 核心执行流程

```typescript
// 文件: sessions-spawn-tool.ts (第87-281行)

// 步骤1: 验证调用者身份 - 禁止子Agent再创建子Agent
if (isSubagentSessionKey(requesterSessionKey)) {
  return jsonResult({
    status: "forbidden",
    error: "sessions_spawn is not allowed from sub-agent sessions",
  })
}

// 步骤2: 权限检查 - 检查allowAgents配置
const allowAgents = resolveAgentConfig(cfg, requesterAgentId)?.subagents?.allowAgents ?? []
const allowAny = allowAgents.some((value) => value.trim() === "*")
if (!allowAny && !allowSet.has(normalizedTargetId)) {
  return jsonResult({
    status: "forbidden",
    error: `agentId is not allowed for sessions_spawn (allowed: ${allowedText})`,
  })
}

// 步骤3: 创建子Session Key
const childSessionKey = `agent:${targetAgentId}:subagent:${crypto.randomUUID()}`

// 步骤4: 解析模型配置（优先级: 显式参数 > 子Agent配置 > 全局默认）
const resolvedModel = normalizeModelSelection(modelOverride)
  ?? normalizeModelSelection(targetAgentConfig?.subagents?.model)
  ?? normalizeModelSelection(cfg.agents?.defaults?.subagents?.model)

// 步骤5: 构建子系统提示
const childSystemPrompt = buildSubagentSystemPrompt({
  requesterSessionKey,
  requesterOrigin,
  childSessionKey,
  label: label || undefined,
  task,
})

// 步骤6: 调用gateway启动子Agent
const response = await callGateway({
  method: "agent",
  params: {
    message: task,
    sessionKey: childSessionKey,
    channel: requesterOrigin?.channel,
    deliver: false,
    lane: AGENT_LANE_SUBAGENT,
    extraSystemPrompt: childSystemPrompt,
    thinking: thinkingOverride,
    timeout: runTimeoutSeconds > 0 ? runTimeoutSeconds : undefined,
    spawnedBy: spawnedByKey,
  },
})

// 步骤7: 注册子Agent运行记录
registerSubagentRun({
  runId: childRunId,
  childSessionKey,
  requesterSessionKey: requesterInternalKey,
  requesterOrigin,
  task,
  cleanup,
  runTimeoutSeconds,
})

// 步骤8: 返回结果
return jsonResult({
  status: "accepted",
  childSessionKey,
  runId: childRunId,
  modelApplied: resolvedModel ? modelApplied : undefined,
  warning: modelWarning,
})
```

### 3.4 子Agent注册与生命周期管理

```typescript
// 文件: subagent-registry.ts (第281-320行)
export function registerSubagentRun(params: {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  cleanup: "delete" | "keep";
  label?: string;
  runTimeoutSeconds?: number;
}) {
  const now = Date.now();
  const cfg = loadConfig();
  const archiveAfterMs = resolveArchiveAfterMs(cfg);
  const archiveAtMs = archiveAfterMs ? now + archiveAfterMs : undefined;
  
  // 注册运行记录到Map中
  subagentRuns.set(params.runId, {
    runId: params.runId,
    childSessionKey: params.childSessionKey,
    requesterSessionKey: params.requesterSessionKey,
    // ...其他字段
    createdAt: now,
    startedAt: now,
    archiveAtMs,
    cleanupHandled: false,
  });
  
  // 持久化到磁盘
  ensureListener();
  persistSubagentRuns();
  
  // 等待子Agent完成
  void waitForSubagentCompletion(params.runId, waitTimeoutMs);
}
```

### 3.5 结果通知机制 (Announce)

```typescript
// 文件: subagent-announce.ts (第348-520行)
export async function runSubagentAnnounceFlow(params: {
  childSessionKey: string;
  childRunId: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  task: string;
  timeoutMs: number;
  cleanup: "delete" | "keep";
  // ...
}): Promise<boolean> {
  
  // 步骤1: 等待子Agent完成或获取最新回复
  if (params.waitForCompletion !== false) {
    const wait = await callGateway({
      method: "agent.wait",
      params: { runId: params.childRunId, timeoutMs: waitMs },
    });
    // 处理超时/错误状态
  }
  
  // 步骤2: 读取子Agent的最终回复
  reply = await readLatestAssistantReply({ sessionKey: params.childSessionKey });
  
  // 步骤3: 构建统计信息
  const statsLine = await buildSubagentStatsLine({
    sessionKey: params.childSessionKey,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
  });
  
  // 步骤4: 构建触发消息
  const triggerMessage = [
    `A background task "${taskLabel}" just ${statusLabel}.`,
    "",
    "Findings:",
    reply || "(no output)",
    "",
    statsLine,
    "",
    "Summarize this naturally for the user...",
  ].join("\n");
  
  // 步骤5: 发送通知回主Agent
  await callGateway({
    method: "agent",
    params: {
      sessionKey: params.requesterSessionKey,
      message: triggerMessage,
      deliver: true,
      channel: directOrigin?.channel,
    },
  });
  
  // 步骤6: 清理（如果cleanup=delete）
  if (params.cleanup === "delete") {
    await callGateway({
      method: "sessions.delete",
      params: { key: params.childSessionKey, deleteTranscript: true },
    });
  }
}
```

### 3.6 子Agent系统提示

```typescript
// 文件: subagent-announce.ts (第291-341行)
export function buildSubagentSystemPrompt(params: {
  requesterSessionKey?: string;
  childSessionKey: string;
  label?: string;
  task?: string;
}) {
  const lines = [
    "# Subagent Context",
    "",
    "You are a **subagent** spawned by the main agent for a specific task.",
    "",
    "## Your Role",
    `- You were created to handle: ${taskText}`,
    "- Complete this task. That's your entire purpose.",
    "- You are NOT the main agent. Don't try to be.",
    "",
    "## Rules",
    "1. **Stay focused** - Do your assigned task, nothing else",
    "2. **Complete the task** - Your final message will be automatically reported to the main agent",
    "3. **Don't initiate** - No heartbeats, no proactive actions, no side quests",
    "4. **Be ephemeral** - You may be terminated after task completion. That's fine.",
    // ...
  ];
  return lines.join("\n");
}
```

### 3.7 OpenClaw的设计特点

1. **Session Key编码**: 使用 `agent:<id>:subagent:<uuid>` 格式明确标识子Agent
2. **权限控制**: 基于`allowAgents`配置允许/禁止跨Agent委派
3. **模型选择**: 支持三层模型配置（显式参数 > 子Agent配置 > 全局默认）
4. **思考级别**: 支持thinking配置控制推理深度
5. **结果通知**: 完整的Announce机制，结果主动推送给主Agent
6. **生命周期管理**: 注册表机制追踪所有子Agent运行状态
7. **自动清理**: 支持`cleanup`参数自动删除子Agent会话
8. **持久化**: 子Agent运行记录持久化到磁盘，支持服务重启恢复
9. **统计信息**: 返回运行时长、token消耗、预估成本等详细统计

---

## 4. 核心代码文件对照

> **根目录**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty`

### 4.1 OpenCode 核心文件

| 功能模块 | 相对路径 | 完整绝对路径 |
|---------|---------|-------------|
| Task工具定义 | `opencode/packages/opencode/src/tool/task.ts` | `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\tool\task.ts` |
| Agent定义与列表 | `opencode/packages/opencode/src/agent/agent.ts` | `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\agent\agent.ts` |
| Session创建 | `opencode/packages/opencode/src/session/index.ts` | `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\session\index.ts` |
| Session处理逻辑 | `opencode/packages/opencode/src/session/prompt.ts` | `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\session\prompt.ts` |
| 权限系统 | `opencode/packages/opencode/src/permission/next.ts` | `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\permission\next.ts` |

### 4.2 OpenClaw 核心文件

| 功能模块 | 相对路径 | 完整绝对路径 |
|---------|---------|-------------|
| sessions_spawn工具 | `openclaw/src/agents/tools/sessions-spawn-tool.ts` | `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\openclaw\src\agents\tools\sessions-spawn-tool.ts` |
| 子Agent注册表 | `openclaw/src/agents/subagent-registry.ts` | `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\openclaw\src\agents\subagent-registry.ts` |
| 结果通知机制 | `openclaw/src/agents/subagent-announce.ts` | `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\openclaw\src\agents\subagent-announce.ts` |
| 通知队列 | `openclaw/src/agents/subagent-announce-queue.ts` | `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\openclaw\src\agents\subagent-announce-queue.ts` |
| Agent配置解析 | `openclaw/src/agents/agent-scope.ts` | `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\openclaw\src\agents\agent-scope.ts` |
| Session Key处理 | `openclaw/src/routing/session-key.ts` | `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\openclaw\src\routing\session-key.ts` |
| 工具策略配置 | `openclaw/src/agents/tool-policy.ts` | `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\openclaw\src\agents\tool-policy.ts` |

---

## 5. 设计理念对比

### 5.1 架构设计

| 维度 | OpenCode | OpenClaw |
|------|----------|----------|
| **Session关系** | parentID链式关联 | Session Key层级编码 |
| **子Agent标识** | 依赖parentID追溯 | 明确的可解析的Key格式 |
| **配置方式** | opencode.json | openclaw.json配置 |
| **权限模型** | PermissionNext规则 | allowAgents白名单 |

### 5.2 消息传递

| 维度 | OpenCode | OpenClaw |
|------|----------|----------|
| **调用方式** | 直接创建Session并执行 | 异步启动，通过Announce回调 |
| **结果返回** | Task tool返回值包含session_id | Announce消息推送到主Session |
| **状态追踪** | Session状态 | SubagentRegistry Map + 磁盘持久化 |

### 5.3 安全性

| 维度 | OpenCode | OpenClaw |
|------|----------|----------|
| **子Agent创建子Agent** | 未明确限制 | 明确禁止 |
| **跨Agent委派** | 依赖permission配置 | allowAgents显式控制 |
| **工具权限** | 继承+过滤 | 子Agent独立策略 |

---

## 6. 关键差异分析

### 6.1 委派模型差异

**OpenCode的委派模型:**
- 更简洁的同步调用模式
- 主Agent等待子Agent完成并直接获取结果
- 通过session_id可以在后续继续该任务
- 适合简单的一次性任务委派

**OpenClaw的委派模型:**
- 异步启动 + 回调通知模式
- 子Agent独立运行，通过Announce机制回报结果
- 支持更复杂的状态管理和持久化
- 适合需要后台运行的任务

### 6.2 权限控制差异

**OpenCode:**
- 使用PermissionNext进行细粒度权限控制
- 基于规则匹配（pattern + action）
- 权限在创建Session时应用

**OpenClaw:**
- 使用allowAgents白名单
- 明确的Agent ID匹配检查
- 支持跨Agent委派的精细控制

### 6.3 生命周期管理差异

**OpenCode:**
- 依赖Session生命周期
- 任务完成后Session保留（除非用户主动结束）
- 通过session_id可以继续历史会话

**OpenClaw:**
- SubagentRegistry管理所有子Agent运行
- 支持自动清理（cleanup参数）
- 持久化存储支持服务重启恢复
- 自动归档机制（archiveAfterMinutes）

### 6.4 特色功能对比

**OpenCode独有:**
- 支持session_id继续历史任务
- 内置的explore和general子Agent
- 与TUI深度集成

**OpenClaw独有:**
- Announce回调机制
- 统计信息（运行时长、token、成本）
- 思考级别（thinking）配置
- 模型优先级选择
- 自动归档和清理
- 嵌套子Agent支持（通过maxSpawnDepth配置）

---

## 7. 总结

### 7.1 设计权衡

**OpenCode设计哲学:** 简洁优先
- 优点: 实现简单、易于理解、与主流程紧耦合
- 适用场景: 快速任务委派、简单探索任务

**OpenClaw设计哲学:** 企业级功能完备
- 优点: 功能全面、可观测性强、可靠性高
- 适用场景: 复杂任务编排、生产环境使用

### 7.2 技术选型建议

| 场景 | 推荐 |
|------|------|
| 简单任务委派 | OpenCode TaskTool |
| 后台任务处理 | OpenClaw sessions_spawn |
| 需要结果统计 | OpenClaw |
| 需要任务持久化 | OpenClaw |
| 嵌套子Agent | OpenClaw |
| 快速集成 | OpenCode |

### 7.3 核心实现要点

1. **Session创建**: 两者都创建独立的Session来运行子Agent
2. **权限控制**: 都实现了基于配置的权限检查机制
3. **结果传递**: OpenCode同步返回，OpenClaw异步通知
4. **状态管理**: OpenCode依赖Session，OpenClaw独立注册表

---

*文档生成日期: 2026-02-16*
*数据来源: 源代码分析*
*根目录绝对地址: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty`*
