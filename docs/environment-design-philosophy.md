# Environment 设计理念：为 Agent 构建可交互的“运行时环境实体”

## 1. 我们想解决的问题

很多 Agent 框架把“运行时”隐含在若干零散组件里：prompt 拼接、工具列表、子代理、事件流、日志、权限、安全策略、会话状态……它们往往分布在不同模块，导致：

- **能力注入分散**：新增一个工具/技能/MCP 往往需要改多处，边界不清晰
- **运行形态难复用**：CLI / Server / 测试环境的差异容易侵入 Agent 核心逻辑
- **可观测性薄弱**：日志、事件、审计、可回放等能力缺少统一入口
- **可控性不足**：超时/并发/重试/权限等策略无法在一个层面统一实施

我们选择把“运行时”明确成一个一等实体：**Environment**。

## 2. 核心主张：Environment 是 Agent 的运行时上下文（且可交互）

在 Agent Core 中，**Environment 是 Agent 运行时的唯一上下文抽象**。它不仅是“配置容器”，更是一个可交互的环境实体，为 Agent 提供：

- **prompt**：system prompt / prompt 仓库 / 动态 prompt 构建
- **sub agents**：子代理的定义、路由与创建（同一套 Agent 逻辑在不同 Env 中呈现不同角色）
- **tools**：原生工具 + MCP 工具 + skills 工具的统一视图
- **mcp**：连接、发现、装配与生命周期管理（把外部能力变成 Env 的工具集一部分）
- **skills**：加载、注册与版本化（将经验/脚本/能力打包成可复用工具）
- **env 原生接口（native interfaces）**：运行日志、事件、审计、安全策略、取消/超时、并发限制、资源与工件管理等

一句话概括：

> **Agent 负责“想清楚做什么”，Environment 负责“在什么世界里、用什么能力、以什么约束去做”。**

## 3. 我们与常见 Agent 框架的关键不同点

### 3.1 Environment 是“世界”，不是“工具集合”

常见做法是把 tools 当作核心扩展点：给 Agent 一个工具列表，剩下的运行时能力由各处“拼起来”。  
我们的做法是把 tools 视为 Environment 的一部分，但不止于 tools。

**Environment 提供的统一入口**带来三个收益：

- **统一治理**：权限、超时、重试、并发、审计、脱敏等策略可在 Env 的执行入口统一落地
- **统一观测**：LLM 流、工具调用、子代理、资源变化等都能以事件形式被订阅/回放
- **统一复用**：Agent 核心逻辑不需要知道运行在 CLI / Server / Test，只依赖 Env 接口

### 3.2 Environment 把“可观测性”变成产品能力

在 Agent 时代，“运行日志/事件流/可回放”不是调试附属品，而是闭环能力（Agent 需要从环境反馈中修正计划、做恢复、给用户解释）。

因此我们把这些能力作为 Environment 的原生接口能力来设计，例如：

- **查看运行日志**：Env 提供查询/订阅运行日志的接口（给 Agent 或 UI）
- **产生事件并反馈**：Env 把 tool 生命周期、LLM streaming、错误、恢复动作等标准化为事件
- **审计与安全**：对敏感参数、文件路径、命令执行等做策略判断与记录

### 3.3 Environment 允许“同一 Agent 在不同世界里工作”

通过特化不同的 Environment（例如 CLI、本地 OS、服务端会话、多租户、测试沙箱），可以实现：

- 同一 Agent 逻辑复用
- 不同的 prompt、工具集、策略约束与观测通道
- 不同的“世界模型”（例如只读文件系统、带模拟网络、带配额限制等）

## 4. Environment 的职责边界（建议作为迭代开发的判断准则）

### 4.1 Agent 应该负责什么

- 任务理解、计划、推理与决策（例如是否调用工具、调用哪个工具、如何组织消息）
- 结构化输出与对用户的解释
- 在得到 Environment 反馈（事件、结果、错误）后进行调整与恢复

### 4.2 Environment 应该负责什么

- 一切 I/O 与外部交互的落地（文件/进程/网络/数据库/MCP/技能执行）
- 工具的注册、列举、执行入口与生命周期管理
- 安全策略与执行治理（权限、超时、并发、重试、审计、脱敏）
- 运行时可观测性（事件流、日志、指标/追踪、可回放/可复现）
- 不同运行形态的差异屏蔽（Server/CLI/Test）

> 经验法则：**当你在做“接入一种新能力/新边界约束/新运行形态”时，优先落在 Environment。**

## 5. 一个可交互 Environment 的能力清单（用于指导后续迭代）

以下不是一次性做完的“大全”，而是一个能持续迭代的路线图。每当需要扩展能力时，优先思考是否补全其中一项。

### 5.1 Prompt 与角色（Agent Specs）

- Prompt 仓库（按 `prompt_id` 管理）
- 动态 prompt 组装（结合 workdir、用户偏好、项目状态、策略约束）
- 多角色/多代理配置（不同 system prompt、不同模型偏好、不同工具白名单）

### 5.2 工具统一视图（Tools）

- 原生工具（如文件、shell、网络等）
- MCP 工具（来自外部 MCP server）
- Skills 工具（项目内/用户态技能）

要求：对 Agent 来说，这三者应呈现为 **同一种“工具”抽象**，并通过 Environment 的统一执行入口治理。

### 5.3 子代理（Sub-agents）

- 子代理的创建与运行由 Environment 统一编排（例如将子代理的工具权限缩小）
- 子代理输出、过程事件可被主 Agent/客户端订阅
- 用于并行探索、验证、长耗时任务分解等

### 5.4 事件与日志（Observability）

Environment 应能把关键过程标准化为事件（可订阅、可回放、可持久化）：

- LLM streaming（start/text/reasoning/completed/error/usage）
- tool 生命周期（tool_call/tool_result/error）
- 子代理生命周期（spawn/handshake/progress/completed/error）
- 策略决策（deny/allow、降级、重试、熔断等）

并提供面向 UI / Agent 的日志/事件接口，例如：

- “查看当前运行日志”
- “订阅当前任务事件流”
- “导出本次任务的可回放记录（replay）”
- **会话（Session）管理**：创建/获取/列表/更新/删除会话作为 Environment 的可选方法（`createSession`、`getSession`、`listSessions`、`updateSession`、`deleteSession`），类型复用 core/session；BaseEnvironment 委托 Session/Storage 实现，未实现的 env 视为无 session 能力。

### 5.5 治理与安全（Control Plane）

建议逐步在 Environment 的执行入口沉淀：

- 超时、取消（AbortSignal / cancellation token）
- 并发与速率限制（per-tool / per-session / per-tenant）
- 权限模型（只读/读写/网络/进程）
- 审计与脱敏（尤其是 tool args、文件路径、token 等）

## 6. 基于 Env Profile 的 Environment 初始化（含远程资源包）

上面我们更多在讲“一个 Environment 里面应该有什么”。但在产品形态上，开发者/用户真正面对的是“**可以切换的环境配置**”，而不是某个具体类名。因此我们引入一个上层抽象：**Env Profile**。

### 6.1 Env Profile：描述“一个可用的环境实例 + 角色配置”

可以用一个概念模型来描述：

```ts
type EnvReference =
  | { kind: "package-url"; url: string; checksum?: string }
  | { kind: "package-name"; name: string; version?: string }
  | { kind: "local-class"; envClass: new (cfg: any) => BaseEnvironment };

interface AgentSpec {
  id: string;
  role: "primary" | "sub";       // primary: 面向用户; sub: 仅子任务
  promptId?: string;             // 引用 env 内部的 prompt
  promptOverride?: string;       // 或者直接覆盖 system prompt
  allowedTools?: string[];       // 工具白名单
  deniedTools?: string[];        // 可选黑名单
}

interface EnvProfileConfig {
  env: EnvReference;
  primaryAgents: AgentSpec[];    // 可直接与用户交互的 agents
  subAgents?: AgentSpec[];       // 仅用于子任务的 agents
}
```

含义：

- `EnvReference` 描述 **这个 Profile 背后用的 Environment 从哪来**：  
  - 远程资源包（`package-url` / `package-name`）
  - 本地已有的 `BaseEnvironment` 子类
- `AgentSpec` 描述 **在该环境里有哪些“角色化的 Agent”**（primary 用于对话，sub 用于子任务）
- `EnvProfileConfig` 则是一个完整的“可切换环境配置”单元，UI 或 Agent orchestrator 可以在多个 Profile 间切换。

### 6.2 形态一：通过远程 env 资源包初始化（可视为“增强版 MCP 服务”）

对于“用 JS 写 env 资源包，然后被框架感知”，我们建议把它看作一种 **增强版 MCP 服务形态**：

- 资源包本质上是一个可以被动态 `import()` 的模块，暴露出一个 manifest：

```ts
export interface EnvPackageManifest {
  id: string;
  displayName: string;
  createEnvironment: (cfg: any) => Promise<BaseEnvironment>;
  defaultPrimaryAgents: AgentSpec[];
  defaultSubAgents?: AgentSpec[];
}

export const envManifest: EnvPackageManifest = { ... };
```

- 框架侧提供一个 Env 管理器（例如 `EnvManager`）：
  - 根据 `EnvReference` 中的 `package-url` / `package-name` 下载或加载模块
  - 做校验（checksum/签名等）
  - 调用 `envManifest.createEnvironment(cfg)` 得到一个具体的 `Environment` 实例
  - 结合 `defaultPrimaryAgents/defaultSubAgents` 以及用户覆盖配置，生成最终的 `EnvProfile`

这与 MCP 的契合点在于：

- **能力暴露层面**：env 资源包最终仍然通过 Environment → tools 的统一抽象暴露能力（可以看成是一种“打成 N 个工具的 MCP 服务”）。
- **发现/装配层面**：我们可以借用 MCP 的发现与连接机制，把 env 资源包注册为一种“环境服务”，只是其元数据比传统 MCP server 更丰富（多了 primary/sub agents、prompt、策略等）。

换句话说：**Env 资源包是“Environment 级别的 MCP 服务”**，不是单个 tool，而是一组 tools + prompts + 策略的组合。

### 6.3 形态二：已有特定 env / env 子类 + 配置 primary/sub agents

对于已经写好的 `OsEnv`、`ServerEnvironment` 或未来用户自定义的 Env 子类，则可以直接用 `local-class` 形态：

```ts
const profile: EnvProfileConfig = {
  env: { kind: "local-class", envClass: OsEnv },
  primaryAgents: [
    {
      id: "coding-assistant",
      role: "primary",
      promptId: "system:coding",
      allowedTools: ["bash", "file_read", "file_write"],
    },
  ],
  subAgents: [
    {
      id: "search-helper",
      role: "sub",
      promptId: "system:search",
      allowedTools: ["file_glob", "file_grep"],
    },
  ],
};
```

这里的设计要点：

- **primary agents**：用于直接与用户交互，必须有明确 prompt 与工具权限范围。
- **sub agents**：仅用于子任务，通常工具更少、更专一，可以在 Environment 侧默认收紧权限。

### 6.4 与 MCP 的关系：优先复用 MCP，而不是重造一套

在更长远的设计里，我们希望：

- **工具层面**：继续把 MCP server 暴露的能力当作 tools 接到 Environment 里（现有 MCP 生态照用不误）。
- **环境层面**：在 MCP 之上再抽一层“Env Profile / Env Package”的规范，用来：
  - 打包 tools + prompts + 策略 + 事件/日志配置
  - 暴露 primary/sub agents 这类更偏“角色与世界”的信息

这样：

- 已有 MCP 生态可以直接挂载到我们的 Environment 上（作为工具来源之一）
- 与此同时，又可以用“增强版 MCP 服务”（env 资源包）来管理和切换整个运行时世界，而不是只管理单个工具

### 6.5 Env 协议：在 MCP 之上定义的一组标准能力

在 MCP 之上，我们可以约定一套 **“Env 协议”**，本质上就是一组命名规范和 schema 规范清晰的 MCP tools，用于描述和操控 Environment：

- **环境描述相关**：
  - `env.get_description`：返回当前环境的 id、displayName、capabilities、支持的 profiles 等
  - `env.list_profiles` / `env.get_profile`：列出或查询 `EnvProfileConfig`（由 Env 服务自己管理 profiles 与 agents 配置）
- **Agent / Prompt 相关**：
  - `env.list_agents` / `env.get_agent`：返回 `AgentSpec` 列表或单个 agent 详情（primary/sub、prompt、工具白名单等）
  - `env.list_prompts` / `env.get_prompt`：按 env/agent 维度返回 prompt 元信息
- **可观测性相关**：
  - `env.query_logs`：基于 sessionId/agentId/level/time range 查询结构化日志
  - `env.stream_logs` / `env.stream_events`：以流式方式订阅运行时事件或日志

这些方法在协议层面都只是“普通 MCP 工具”，但：

- **对 MCP 客户端来说**：它们构成了一个“可发现的环境描述与观测 API”
- **对 agent-core 来说**：它们刚好与本文件中的 `EnvProfileConfig` / `AgentSpec` / 日志与事件模型一一对应  
  → core SDK 可以提供：
  - **Env 协议 Server 端封装**：一行代码把任意 `Environment` 暴露为符合 Env 协议的 MCP 服务
  - **Env 协议 Client 端封装**：一行代码把任意 Env-MCP 服务映射成本地可消费的 `EnvDescription` / `EnvProfile` / `AgentSpec` / `LogEntry` 对象

在当前实现中：

- Env 协议的 JSON 规范位于：`packages/core/env_spec/json_spec/env-protocol.json`
- TypeScript 类型与 SDK：
  - `packages/core/env_spec/types.ts`：`EnvDescription` / `EnvProfile` / `AgentSpec` / `LogEntry`
  - `packages/core/env_spec/client.ts`：`EnvClient`（基于抽象 `EnvRpcClient`，可对接任意 MCP Client）
  - `packages/core/env_spec/server.ts`：`createEnvMcpServer` / `createBaseEnvMcpServer`
  - `packages/core/env_spec/base_env`：从 `BaseEnvironment` 推导默认 `EnvDescription` / `EnvProfile`

这让我们可以在不发明“第二套协议”的前提下，直接利用 MCP 生态完成 Environment 级别的发现、装配与切换。

---

## 7. 运行时工作流（概念）

一个典型的工作流可以理解为：

1. 用户提出任务
2. Agent 在 Environment 提供的 prompt/工具/策略约束下推理与决策
3. Agent 通过 Environment 的统一入口执行工具/调用 LLM/派生子代理
4. Environment 将过程标准化为事件（日志/流）反馈给 Agent 与客户端
5. Agent 根据反馈调整策略，直到完成任务

> 关键点：**反馈通道属于 Environment**，而不是散落在工具实现或 UI 层。

## 8. 如何用这份理念指导“迭代开发”（落地检查表）

当你要做一个新功能/新能力时，优先按下面顺序落地：

- **抽象入口**：这件事是否应成为 Environment 的能力（接口/方法/事件）？
- **执行治理**：它是否应该走统一执行入口（以获得超时/权限/审计/并发控制）？
- **观测闭环**：要补哪些事件与日志，才能让 Agent/用户看见“发生了什么、为什么这样做”？
- **可复现**：是否需要记录足够上下文支持回放/重现（例如 tool args 的脱敏存档）？
- **运行形态**：CLI/Server/Test 的差异是否被 Environment 子类隔离住，而不是侵入 Agent？

如果以上问题都能在 Environment 层得到答案，Agent 核心逻辑会更稳定、更可复用。

