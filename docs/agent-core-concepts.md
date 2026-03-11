# Agent-Core 核心概念与架构文档

> 版本: 0.1.0 | Commit: d912ead3d34d7c73177c0d523de3c31ecccccf64

## 目录

1. [核心实体总览](#核心实体总览)
2. [核心概念详解](#核心概念详解)
3. [架构分层](#架构分层)
4. [实体关系图](#实体关系图)
5. [核心机制](#核心机制)
6. [配置系统](#配置系统)
7. [事件系统](#事件系统)

---

## 核心实体总览

Agent-Core 是一个基于 LLM 的智能代理框架，核心围绕 **Environment（环境）**、**Agent（代理）**、**Session（会话）** 三大实体构建。

| 实体 | 描述 | 核心职责 |
|------|------|----------|
| **Environment** | 运行环境容器 | 工具注册、LLM 调用、会话管理、技能加载、MCP 集成 |
| **Agent** | 执行引擎 | LLM 对话循环、工具调用决策、行为规范执行 |
| **Session** | 对话上下文容器 | 消息存储、历史管理、上下文追踪 |
| **Tool** | 能力扩展 | 外部能力封装（文件系统、网络请求等） |
| **Skill** | 领域技能包 | 专业化指令集、工作流封装 |
| **EventBus** | 事件中枢 | 事件发布订阅、规则路由、SSE 流式推送 |
| **MCP Server** | 外部服务集成 | Model Context Protocol 协议扩展 |

---

## 核心概念详解

### 1. Environment（环境）

Environment 是 agent-core 的核心容器类，提供代理运行所需的一切基础设施。

#### 继承层次

```
Environment (interface)
    ↑
BaseEnvironment (abstract class)
    ↑
ServerEnvironment (concrete class)
```

#### BaseEnvironment 核心功能

```typescript
abstract class BaseEnvironment implements Environment {
  // 工具管理
  tools: Map<string, Tool>
  registerTool(tool: Tool): ToolRegistration
  unregisterTool(name: string): boolean
  listTools(): Tool[]
  
  // 会话管理
  createSession(options?: SessionCreateOptions): Session
  getSession(id: string): Session | undefined
  listSessions(): Session[]
  
  // 技能管理
  skills: Map<string, SkillInfo>
  loadSkills(): Promise<{ added: SkillInfo[]; removed: string[] }>
  listSkills(): SkillInfo[]
  
  // 行为规范
  getBehaviorSpec(agentId?: string): Promise<BehaviorSpec>
  getEnvRules(): Promise<string>
  
  // LLM 调用
  invokeLLM(messages, tools?, context?, options?): Promise<ToolResult>
  configureLLM(config: InvokeLLMConfig): void
  
  // 查询处理
  handle_query(query: string, context?: Context, history?: ModelMessage[]): Promise<string>
  handle_action(action: Action, ctx: Context): Promise<ToolResult>
}
```

#### ServerEnvironment 扩展功能

- **配置加载**: 从配置文件加载 Provider、Model、Auth 等设置
- **环境切换**: 支持多环境配置（dev、prod 等）
- **MCP 集成**: 加载和管理 MCP 客户端
- **EventSource**: 支持事件源 MCP（如定时器、飞书消息）
- **流式事件**: 通过 EventBus 发布 SSE 事件到前端
- **后台任务**: 支持子代理后台执行

### 2. Agent（代理）

Agent 是执行引擎，负责 LLM 对话循环和工具调用决策。

#### 核心运行逻辑

```typescript
class Agent {
  async run(): Promise<string> {
    // 1. 获取行为规范
    const behaviorSpec = await this.env.getBehaviorSpec(this.agentId)
    
    // 2. 构建系统消息
    const systemMessage = this.buildSystemMessage(behaviorSpec)
    
    // 3. 主循环（ReAct 模式）
    while (iterations < maxIterations) {
      // 调用 LLM
      const output = await this.env.invokeLLM(messages, tools)
      
      // 处理输出
      if (output.text) {
        // 文本响应，直接返回
        return output.text
      }
      
      if (output.toolCalls) {
        // 工具调用
        for (const toolCall of output.toolCalls) {
          const result = await this.env.handle_action(...)
          messages.push(toolResult)
        }
      }
    }
  }
}
```

#### 核心配置

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| maxIterations | 100 | 最大迭代次数 |
| maxErrorRetries | 3 | 错误重试次数 |
| doomLoopThreshold | 3 | 检测死循环的阈值 |

### 3. Session（会话）

Session 管理对话上下文，支持持久化存储。

#### 核心功能

```typescript
class Session {
  // 消息管理
  addMessage(info: MessageInfo, parts: Part[]): string
  addUserMessage(content: string): string
  addAssistantMessage(content: string): string
  addToolMessage(toolName, callID, output, input): string
  
  // 历史转换
  toHistory(): Promise<ModelMessage[]>
  
  // 父子会话
  static createChild(parentID, title?, directory?): Session
  static fork(sessionID, messageID?): Session
  
  // 压缩（上下文管理）
  compact(env, options?): Promise<Session>
}
```

#### 消息结构

```
Session
└── Message[]
    ├── role: user | assistant | system | tool
    ├── parts: Part[]
    │   ├── TextPart (文本内容)
    │   ├── ReasoningPart (推理过程)
    │   ├── ToolPart (工具调用/结果)
    │   └── FilePart (文件附件)
    └── metadata
```

#### 持久化

- **存储模式**: SQLite（默认）/ Memory
- **自动保存**: 默认开启
- **消息限制**: 100 条（可配置压缩）

### 4. Tool（工具）

Tool 是 agent 与外部世界交互的能力扩展。

#### 工具定义

```typescript
interface Tool {
  name: string           // 工具名称
  description: string   // 工具描述（用于 LLM 选择）
  parameters: ZodType   // 参数 Schema
  execute(args, context): Promise<ToolResult>
}
```

#### 内置工具

| 工具类别 | 工具示例 | 功能 |
|----------|----------|------|
| **OS 工具** | read_file, write_file, bash, glob, grep | 文件系统操作 |
| **Todo 工具** | todo_read, todo_add, todo_write | 任务管理 |
| **Web 工具** | web_fetch, exa_web_search | 网络请求 |
| **LSP 工具** | lsp (goToDefinition, findReferences) | 代码分析 |
| **Trace 工具** | get_trace, get_logs_for_request | 日志分析 |
| **GitHub 工具** | fetch_agent_core_source | 源码获取 |
| **Task 工具** | task, stop_task | 子代理委托 |

#### 工具执行流程

```
LLM 决定调用工具
    ↓
Environment.handle_action(Action)
    ↓
检查并发限制 (ConcurrencyManager)
    ↓
获取超时配置 (TimeoutManager)
    ↓
执行错误恢复 (ErrorRecovery)
    ↓
调用 Tool.execute()
    ↓
记录指标 (MetricsCollector)
    ↓
返回 ToolResult
```

### 5. Skill（技能）

Skill 是领域特定的知识和工作流封装。

#### Skill 结构

```typescript
interface SkillInfo {
  id: string
  name: string
  description: string
  path: string          // skill 文件路径
  content?: string      // skill 内容（内联时使用）
}
```

#### Skill 加载

- **内置 Skill**: 在代码中定义（如 tong_work_help）
- **用户 Skill**: 从 `environments/{env}/skills/` 目录加载
- **动态加载**: 每次 query 前重新扫描，支持运行时增删

### 6. MCP（Model Context Protocol）

MCP 是外部服务集成协议，支持连接各种外部工具和服务。

#### MCP 架构

```
Environment
    └── McpManager
            ├── McpClient (每个 server 一个)
            │       ├── StdioClient (stdio 进程)
            │       └── SSEClient (HTTP SSE)
            └── MCP Tools (自动转换)
```

#### MCP 配置

```typescript
// config.jsonc
{
  "mcp": {
    "clients": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "./data"]
      }
    }
  }
}
```

### 7. EventSource MCP

EventSource 是事件驱动的 MCP，支持：

- **定时器事件**: `timer.*`
- **飞书消息**: 接收飞书消息事件
- **自定义事件**: 支持手动触发

---

## 架构分层

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                       │
│  (HTTP Server, SSE, WebSocket, TUI)                        │
├─────────────────────────────────────────────────────────────┤
│                    Application Layer                        │
│  ServerEnvironment, EventBus, Command System               │
├─────────────────────────────────────────────────────────────┤
│                      Domain Layer                           │
│  BaseEnvironment, Agent, Session, Tool, Skill              │
├─────────────────────────────────────────────────────────────┤
│                   Infrastructure Layer                      │
│  LLM Provider, MCP Client, Storage, Config                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 实体关系图

```
                    ┌──────────────────┐
                    │   AgentServer    │
                    │   (HTTP Server)  │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ServerEnvironment │
                    │  (运行环境)       │
                    └────────┬─────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼───────┐  ┌────────▼────────┐  ┌────────▼────────┐
│  Tool Manager │  │   EventBus     │  │  Session Manager│
│  (工具管理)    │  │   (事件中枢)    │  │  (会话管理)      │
└───────┬───────┘  └────────┬────────┘  └────────┬────────┘
        │                   │                    │
        │           ┌───────▼───────┐    ┌───────▼───────┐
        │           │  EnvEventBus  │    │    Session    │
        │           │ (规则引擎)     │    │  (会话实例)    │
        │           └───────────────┘    └───────────────┘
        │
┌───────▼───────┐  ┌───────────────┐  ┌───────────────┐
│    Tool       │  │     Agent      │  │     Skill     │
│  (文件/网络)   │  │  (执行引擎)    │  │  (领域技能)    │
└───────────────┘  └───────┬───────┘  └───────────────┘
                            │
                    ┌───────▼───────┐
                    │      LLM      │
                    │ (AI Provider) │
                    └───────────────┘
```

---

## 核心机制

### 1. 工具执行机制

```
┌─────────────────────────────────────────────────────────────┐
│                    Tool Execution Pipeline                  │
├─────────────────────────────────────────────────────────────┤
│  1. concurrencyManager.acquireSlot()                       │
│     └─> 检查并发限制，阻塞或排队                              │
│                                                             │
│  2. timeoutManager.getTimeout()                             │
│     └─> 获取工具特定超时配置                                  │
│                                                             │
│  3. errorRecovery.executeWithRecovery()                     │
│     └─> 重试策略 + 错误恢复                                   │
│                                                             │
│  4. tool.execute()                                          │
│     └─> 实际执行工具                                         │
│                                                             │
│  5. metricsCollector.record()                               │
│     └─> 记录执行指标                                         │
│                                                             │
│  6. emitStreamEvent()                                       │
│     └─> 发布工具调用/结果事件                                │
└─────────────────────────────────────────────────────────────┘
```

#### 超时与重试配置

| 工具 | 默认超时 | 最大重试 | 并发限制 |
|------|----------|----------|----------|
| 默认 | 30s | 3 | 5 |
| 可配置 | `getTimeoutOverride()` | `getMaxRetries()` | `getConcurrencyLimit()` |

### 2. 行为规范机制

```
┌─────────────────────────────────────────────────────────────┐
│                   Behavior Spec Pipeline                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Environment.getBehaviorSpec(agentId)                      │
│       │                                                     │
│       ├── envRules (rules.md)                              │
│       │   └── 加载自 environments/{env}/rules.md           │
│       │                                                     │
│       ├── agentPrompt (.prompt 文件)                         │
│       │   └── 加载自 environments/{env}/prompts/          │
│       │                                                     │
│       └── combinedPrompt                                    │
│           ├── # Environment: {envName}                     │
│           ├── # Agent: {agentId}                           │
│           ├── Working directory: {cwd}                      │
│           ├── Today: {date}                                │
│           ├── ---                                           │
│           ├── # Environment Behavior Guidelines            │
│           ├── {envRules}                                    │
│           ├── ---                                           │
│           └── # Agent: {agentId}                           │
│               {agentPrompt}                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. 事件驱动机制

#### EventBus 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      EventBus System                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐   │
│  │  Publisher  │───▶│   Queue     │───▶│   Handler   │   │
│  │  (发布者)    │    │   (队列)     │    │  (处理器)    │   │
│  └─────────────┘    └─────────────┘    └─────────────┘   │
│        │                                     │             │
│        │      ┌─────────────────────┐       │             │
│        └─────▶│  EnvEventBus        │◀──────┘             │
│               │  (规则路由引擎)        │                     │
│               └──────────┬────────────┘                     │
│                          │                                  │
│               ┌──────────▼──────────┐                      │
│               │    Event Rules       │                      │
│               │  - USER_QUERY        │                      │
│               │  - SESSION_CREATED   │                      │
│               │  - BACKGROUND_TASK_* │                     │
│               │  - timer.*           │                      │
│               │  - * (wildcard)      │                      │
│               └──────────────────────┘                      │
│                                                             │
│  事件类型                                                    │
│  ├── StreamEvent (流式事件)                                  │
│  │   ├── start, text, reasoning                            │
│  │   ├── tool_call, tool_result                            │
│  │   └── completed, error                                   │
│  │                                                          │
│  └── SessionEvent (会话事件)                                 │
│      ├── session.created                                    │
│      ├── session.updated                                    │
│      └── session.deleted                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### 事件规则处理

```typescript
interface EnvEventRule {
  eventType: string | string[]      // 事件类型（支持通配符）
  handler: {
    type: "function" | "agent"
    fn?: (event) => Promise<void>
    prompt?: string                  // Agent 处理时的 prompt
  }
  options?: {
    enabled?: boolean
    priority?: number                // 优先级（越高越先执行）
  }
}
```

### 4. 配置加载机制

```
┌─────────────────────────────────────────────────────────────┐
│                    Config Loading Pipeline                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ServerEnvironment.loadFromConfig()                         │
│       │                                                     │
│       ├── 1. Config_get()                                   │
│       │   └── 加载 config.jsonc                             │
│       │                                                     │
│       ├── 2. resolveConfig()                                │
│       │   └── 解析配置，合并默认值                           │
│       │                                                     │
│       ├── 3. ProviderManager.initialize()                   │
│       │   └── 初始化 LLM Provider                          │
│       │                                                     │
│       ├── 4. Storage.initialize()                           │
│       │   └── 初始化会话存储                                │
│       │                                                     │
│       ├── 5. loadBehaviorSpec()                            │
│       │   └── 加载 rules.md + prompts                      │
│       │                                                     │
│       ├── 6. loadSkills()                                  │
│       │   └── 加载 skills 目录                              │
│       │                                                     │
│       ├── 7. initializeMcp()                               │
│       │   └── 加载 MCP 客户端                               │
│       │                                                     │
│       └── 8. configureLLM()                               │
│           └── 初始化 LLM                                    │
│                                                             │
│  模型选择优先级                                              │
│  recent > config default > provider default                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 5. 环境切换机制

```
┌─────────────────────────────────────────────────────────────┐
│                 Environment Switching                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Environment.switchEnvironment(envName)                     │
│       │                                                     │
│       ├── 1. 更新 configRegistry                           │
│       │   └── 移除旧环境源，添加新环境源                      │
│       │                                                     │
│       ├── 2. Config_reload()                               │
│       │   └── 重新加载配置                                  │
│       │                                                     │
│       ├── 3. 断开旧 MCP 连接                                │
│       │   └── mcpManager.disconnectAll()                  │
│       │                                                     │
│       ├── 4. 切换 mcpservers 目录                          │
│       │   └── environments/{newEnv}/mcpservers            │
│       │                                                     │
│       ├── 5. 初始化新 MCP                                   │
│       │   └── initializeMcp(newConfig.mcp)                │
│       │                                                     │
│       ├── 6. 切换 skills 目录                               │
│       │   └── environments/{newEnv}/skills                │
│       │                                                     │
│       ├── 7. 刷新行为规范                                    │
│       │   └── refreshBehaviorSpec()                        │
│       │                                                     │
│       └── 8. 通知前端                                        │
│           └── 发送环境切换通知消息                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 配置系统

### 配置文件结构

```jsonc
// ~/.config/tong_work/config.jsonc
{
  // 当前激活环境
  "activeEnvironment": "sszst",
  
  // 默认模型
  "defaultModel": "anthropic/claude-3-sonnet-20240229",
  
  // MCP 配置
  "mcp": {
    "clients": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "./data"]
      }
    },
    "eventSources": {
      "enabled": true,
      "sources": { ... }
    }
  },
  
  // Session 持久化
  "session": {
    "persistence": {
      "mode": "sqlite",
      "path": "~/.local/share/tong_work/sessions.db",
      "autoSave": true
    }
  },
  
  // Trace 配置
  "trace": {
    "enabled": true,
    "recordParams": true,
    "recordResult": false,
    "log": false
  },
  
  // 日志配置
  "logging": {
    "path": "~/.local/share/tong_work/logs"
  }
}
```

### 环境目录结构

```
~/.config/tong_work/
├── config.jsonc                 # 主配置
├── auth.json                     # API 密钥
├── models.jsonc                  # 模型配置
└── environments/
    ├── sszst/
    │   ├── rules.md              # 环境规则
    │   ├── skills/                # 技能目录
    │   ├── prompts/               # Prompt 目录
    │   │   └── system.prompt
    │   └── mcpservers/            # MCP 服务目录
    └── prod/
        ├── rules.md
        ├── skills/
        └── mcpservers/
```

---

## 事件系统

### 核心事件类型

| 事件类型 | 描述 | 载荷 |
|----------|------|------|
| `USER_QUERY` | 用户查询 | `{ sessionId, content }` |
| `SESSION_CREATED` | 会话创建 | `{ sessionId, title, directory }` |
| `SESSION_UPDATED` | 会话更新 | `{ sessionId, updates }` |
| `SESSION_DELETED` | 会话删除 | `{ sessionId }` |
| `BACKGROUND_TASK_COMPLETED` | 后台任务完成 | `{ taskId, result, ... }` |
| `BACKGROUND_TASK_FAILED` | 后台任务失败 | `{ taskId, error, ... }` |
| `BACKGROUND_TASK_PROGRESS` | 后台任务进度 | `{ taskId, description, ... }` |
| `ENVIRONMENT_SWITCHED` | 环境切换 | `{ oldEnv, newEnv }` |
| `timer.*` | 定时器事件 | `{ ... }` |

### SSE 流式事件

通过 `/events` 端点推送：

```
GET /events?sessionId=xxx

Response:
Content-Type: text/event-stream

event: stream.start
data: {"sessionId":"xxx","messageId":"msg_1","model":"claude-3"}

event: stream.text
data: {"sessionId":"xxx","messageId":"msg_1","content":"Hello","delta":"Hello"}

event: stream.tool_call
data: {"sessionId":"xxx","toolName":"read_file","toolArgs":{...}}

event: stream.completed
data: {"sessionId":"xxx","usage":{"totalTokens":100}}
```

---

## 附录

### 关键文件路径

| 组件 | 文件路径 |
|------|----------|
| Environment | `packages/core/src/server/environment.ts` |
| BaseEnvironment | `packages/core/src/core/environment/base/base-environment.ts` |
| Agent | `packages/core/src/core/agent/index.ts` |
| Session | `packages/core/src/core/session/session.ts` |
| EventBus | `packages/core/src/server/eventbus/bus.ts` |
| MCP Manager | `packages/core/src/env_spec/mcp/manager.ts` |
| Config | `packages/core/src/config/index.ts` |

### API 端点

| 端点 | 方法 | 功能 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/events` | GET | SSE 事件流 |
| `/sessions` | GET | 列出会话 |
| `/sessions` | POST | 创建会话 |
| `/sessions/:id` | GET | 获取会话详情 |
| `/sessions/:id/messages` | GET | 获取会话消息 |
| `/sessions/:id` | PATCH | 更新会话 |
| `/sessions/:id` | DELETE | 删除会话 |
| `/commands` | POST | 执行命令 |

---

*文档生成时间: 2026-03-11*
