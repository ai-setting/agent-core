# Agent-Core 环境设计理念

## 1. 核心理念

**Agent-Core 通过 Environment（环境）为 Agent 运行时提供完整的“环境”**：一切 Agent 运行所需的能力与约束都由 Environment 定义与提供。Agent 不直接依赖具体实现，只依赖 Environment 接口，从而做到“换环境即换能力、换约束”。

核心等式可以概括为：

```
Agent 运行时 = Environment 提供的（Agents 配置 + 工具集 + 可选扩展）
```

- **Agents 配置**：环境中可用的“智能体”及其行为定义（含 system prompt、模型偏好等）。
- **工具集**：Env 暴露给 Agent 的工具，包括原生工具、MCP 工具、Skills 等。
- **特化任务**：通过 **`new` 一个特化的 Environment** 来承载某种特定任务或场景（如服务端会话、本地 CLI、测试环境等）。

---

## 2. Environment 的职责

Environment 是 Agent 运行时的唯一“环境抽象”，负责三件事：

### 2.1 为 Agent 提供“环境中的 Agents”配置

- Environment 决定**当前环境里有哪些 Agent 可用**，以及每个 Agent 的**行为定义**。
- 行为定义主要包括：
  - **Prompt**：system prompt（及可选的 prompt 仓库），由 `getPrompt(prompt_id)` 提供。
  - **模型与参数**：若由 Env 统一管理 LLM，则模型、temperature 等也可视为“Agent 配置”的一部分。
- Agent 运行时从 Environment 获取“当前要用的 Agent”的 prompt（及可选配置），而不是写死在代码里，从而**同一套 Agent 逻辑可在不同 Env 中呈现不同角色与能力**。

在实现上：

- `BaseEnvironment` 内建 **Prompt 仓库**（`prompts: Map<string, Prompt>`），通过 `addPrompt` / `getPrompt` 管理。
- 构造 Env 时（或在子类中）可注入默认的 system prompt，或按“逻辑 Agent”挂载多组 prompt（如 `system`、`plan`、`explore` 等），由上层在 `handle_query` 时选择使用哪个 prompt，即选择“哪个 Agent”。

### 2.2 提供工具集（Tools）

- Environment 是**工具集的唯一提供方**。所有对文件、网络、子进程、MCP、Skills 等的访问，都通过 Env 注册的工具暴露给 Agent。
- 工具集可包含：
  - **原生工具**：由 Env 实现直接注册（如 `bash`、`read`、`write`、`grep` 等）。
  - **MCP（Model Context Protocol）工具**：由 Env 集成 MCP 客户端，将 MCP 暴露的能力注册为工具。
  - **Skills**：由 Env 加载并注册的 Skill 能力（例如从某目录扫描并注册为工具）。
- Agent 只看到 `getTools()` / `listTools()` 的返回值；**不关心工具来自“原生”“MCP”还是“Skill”**，从而便于扩展与替换。

在实现上：

- `BaseEnvironment` 提供 `registerTool` / `unregisterTool` / `getTools`，子类（如 `OsEnv`、`ServerEnvironment`）在构造或 `registerDefaultTools()` 中注册原生工具；后续可在同一套机制下挂载 MCP 与 Skills。

### 2.3 统一工具执行入口：handle_action

- 所有工具调用都通过 **`handle_action(action, context)`** 进入 Environment，由 Env 做路由、超时、重试、并发限制、权限与审计等。
- Agent 只发起 `handle_action`，不直接执行任何 I/O 或外部服务调用，从而**行为可观测、可管控、可测试**。

---

## 3. 通过“特化 Environment”完成特定任务

设计上鼓励**用不同的 Environment 实现对应不同的任务或运行形态**，而不是在一个巨型 Env 里用配置区分一切。

- **服务端会话**：`new ServerEnvironment(config)` — 注册 OS 工具 + 与 EventBus/SSE 集成，用于多会话、流式推送。
- **本地/CLI**：`new OsEnv(config)` — 注册文件/进程等 OS 工具，指定 workdir、model、systemPrompt，用于单机或 CLI。
- **测试/自动化**：`new TestEnv(config)` — 注册 mock 工具、可控的“假” LLM，用于单测或 E2E。

同一套 Agent 逻辑（接收 event、组 messages、调用 `env.handle_action("invoke_llm", ...)` 并处理 tool_calls）可在上述任意 Env 中复用；**换 Environment 即换“在哪运行、用什么工具、用什么 Agent 配置”**。

典型用法示例：

```typescript
// 服务端：为某会话创建一个带 EventBus 的 Environment
const env = new ServerEnvironment({ sessionId: "sess-1", systemPrompt: "You are a coding assistant." });
await env.handle_query("List files in project", context);

// 本地/CLI：创建面向当前工作目录的 OS 环境
const env = new OsEnv({ workdir: process.cwd(), model: "openai/gpt-4o", systemPrompt: "You are a pair programmer." });
await env.handle_query("Summarize the codebase", context);
```

---

## 4. 与现有实现的对应关系

| 理念要点           | 代码/模块对应 |
|--------------------|----------------|
| Environment 接口   | `core/environment/index.ts` — `Environment` 接口 |
| 工具集 + 执行入口  | `BaseEnvironment`：`registerTool`、`getTools`、`handle_action` |
| Prompt / Agents 配置 | `BaseEnvironment`：`prompts`、`addPrompt`、`getPrompt`；构造参数 `systemPrompt` |
| 特化 Env          | `ServerEnvironment`（server）、`OsEnv`（expend/os） |
| Agent 只依赖 Env  | `Agent` 构造函数接收 `env`、`tools`（来自 env）、`prompt`（来自 env） |

---

## 5. 扩展方向（MCP、Skills、多 Agent 配置）

- **MCP**：在某个特化 Env（如 `ServerEnvironment` 或 `OsEnv`）中，在启动时连接 MCP 服务，将其提供的工具逐一 `registerTool`，即成为该 Env 工具集的一部分。
- **Skills**：同理，从配置或目录加载 Skill，将每个 Skill 暴露的能力注册为工具，由 Env 统一通过 `handle_action` 执行。
- **多 Agent 配置**：在 Env 中维护多组 prompt（及可选模型参数），`handle_query` 或上层根据请求类型/路由选择“用哪个 Agent”，再 `new Agent(..., env.getPrompt(agentId), ...)` 即可。

这些扩展都遵循同一原则：**能力与约束都通过 Environment 注入，Agent 只依赖 Environment 接口**。

---

## 6. 小结

- **Environment** 是 Agent 运行时的“环境”抽象：提供 **Agents 配置（含 prompt）** 与 **工具集（原生 + MCP + Skills）**，并统一 **`handle_action`** 执行。
- 通过 **`new` 一个特化的 Environment**（如 `ServerEnvironment`、`OsEnv`、`TestEnv`）即可完成特定任务或运行形态，无需改 Agent 核心逻辑。
- 文档与实现保持一致后，后续新增 MCP、Skills 或多 Agent 配置时，只需在对应 Environment 实现中扩展注册与配置即可。

---

## 7. 相关文档

- [架构总览](architecture/overview.md) — 应用层与 EventBus/SSE 的集成
- [design/agent-core-architecture.md](../../design/agent-core-architecture.md) — 详细架构与数据结构（Env/BaseEnv/OsEnv、Agent、流式事件等）
