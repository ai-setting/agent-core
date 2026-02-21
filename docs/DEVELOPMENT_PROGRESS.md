# Agent Core 开发进度与路线图（Progress & Roadmap）

> 目的：这是一份 **长期维护的"进展参照文档"**。团队成员只需要看它，就能知道我们沿着设计目标前进了多少、当前短板是什么、接下来优先做什么。

- **设计目标（必读）**：[`docs/environment-design-philosophy.md`](./environment-design-philosophy.md)
- **历史设计稿（参考）**：`docs/old/`（见 [`docs/README.md`](./README.md)）

---


## 1. 更新约定（如何维护这份文档）

- **更新时机**：每次合入"影响 Environment/Agent 运行时能力"的变更（tools/mcp/skills/事件/会话/可靠性/安全策略）都要更新本文件。
- **更新内容**：
  - 在「能力矩阵」里修改状态与备注（附上关键代码路径）
  - 在「近期待办」里增加/关闭条目（尽量可执行、可验收）
  - 如有关键设计变更，在「决策记录」补一条
- **更新时间**：在文档顶部附近加一行 `最后更新：YYYY-MM-DD`

最后更新：2026-02-21（新增 BehaviorSpec 机制 - 环境级规则 + agent 特定 prompt 的分层注入）

---


## 2. 当前进度快照（结论前置）

### 2.1 已经具备的主干能力（可用/可演示）

- **Environment 核心骨架**：`Environment` 接口、`BaseEnvironment`（工具注册、prompt 仓库、handle_action、stream hook 等）
- **LLM 调用与流式事件**：`invoke_llm` + `onStreamEvent` hook 打通
- **Server 侧事件总线与 SSE**：EventBus 发布订阅 + `/events` SSE 推送
- **OS 环境与基础工具**：`OsEnv` + bash/file 等工具（并配置默认超时/并发/重试）

### 2.2 明显缺口（尚未体系化/尚未落地）

- **MCP 集成**：尚无统一"连接/发现/装配为工具"的实现
- **Skills 体系**：尚无"技能包加载→注册为工具→版本化/隔离"的实现
- **Sub-agents**：尚无子代理编排与权限收敛机制
- **Environment 原生接口**（日志查询、事件回放、工件/资源管理、审计查询等）：目前仅有事件推送的部分链路
- **配置系统**：用户级配置、状态持久化尚未实现

---


## 3. 能力矩阵（按设计目标对齐）

状态标记：
- **[DONE]**：已落地，且有明确入口可复用
- **[WIP]**：已开始，有部分能力但不完整/不稳定
- **[TODO]**：未开始或仅有零散代码，不成体系

| 能力域 | 目标能力 | 状态 | 现状/备注 | 关键代码路径（示例） |
|---|---|---|---|---|
| 配置系统 | 用户级配置（Global）+ 环境变量扩展 | [DONE] | Phase 1 已完成：ConfigPaths、ConfigSource、Registry、Schema、Merge、Loader 全部实现 | `packages/core/src/config/**` |
| 配置状态持久化 | 用户级模型选择（recent/favorite/variant） | [DONE] | Phase 2 已完成：ModelStore 实现，支持 recent/favorite/variant 的增删改查与文件持久化 | `packages/core/src/config/state/model-store.ts` |
| 配置系统集成 | ServerEnvironment 自动加载配置并初始化 LLM | [DONE] | ServerEnvironment 构造函数自动加载配置，解析 apiKey/baseURL/model，初始化 LLM | `packages/core/src/server/environment.ts` |
| 认证管理 | auth.json 自动加载到环境变量 | [DONE] | Auth_loadToEnv() 自动从 auth.json 加载 API key 到对应环境变量，支持 Provider 映射 | `packages/core/src/config/auth.ts` |
| Command 系统 | 命令注册、执行、Dialog 集成 | [DONE] | Command Registry + 内置命令（echo/connect/models）+ TUI Dialog 集成 | `packages/core/src/server/command/**`、`packages/core/src/cli/tui/components/*Dialog.tsx` |
| Models Command | 模型选择与管理 | [DONE] | 支持 list/select/toggle_favorite，集成 ModelStore 和 ServerEnvironment | `packages/core/src/server/command/built-in/models.ts`、`packages/core/src/cli/tui/components/ModelsDialog.tsx` |
| Models 配置加载 | 从配置文件加载模型列表 | [DONE] | 支持从 environments/{env}/models.jsonc 或 provider.*.models 加载模型配置，优先级：Environment > Provider > Built-in | `packages/core/src/config/models-config.ts` |
| Environment 核心 | 统一运行时上下文（prompt/tools/事件/策略入口） | [DONE] | `Environment` + `BaseEnvironment` 已形成骨架；可选 getProfiles/queryLogs/session 五方法 | `packages/core/src/core/environment/index.ts`、`.../base/base-environment.ts` |
| BehaviorSpec | 环境级规则 + agent 特定 prompt 分层注入 | [DONE] | 支持从 rules.md 加载环境级共享规则，从 prompts/*.prompt 加载 agent 特定 prompt，组合成完整 system prompt | `packages/core/src/core/environment/index.ts`（BehaviorSpec 类型）、`.../base/base-environment.ts`（getBehaviorSpec/filterToolsByPermission） |
| Prompt | prompt 仓库、system prompt 注入 | [DONE] | `prompts: Map` + `addPrompt/getPrompt`（BaseEnvironment 内） | `.../base/base-environment.ts` |
| Tools | 工具注册/列举/执行统一入口 | [DONE] | `registerTool/getTools/handle_action`（BaseEnvironment） | `.../base/base-environment.ts` |
| LLM | invoke_llm 作为工具 + stream hook | [DONE] | 流式事件通过 `onStreamEvent` 向上抛 | `.../base/invoke-llm.ts`、`.../base/base-environment.ts` |
| 事件（统一流） | LLM + Tool 生命周期事件标准化 | [DONE] | `StreamEvent` 类型已定义，hook 已接入 | `packages/core/src/core/environment/index.ts` |
| Server 事件总线 | publish/subscribe，支持 session scope | [DONE] | bus + global broadcast 已落地 | `packages/core/src/server/eventbus/*` |
| SSE 推送 | `/events` 推送 EventBus 事件 | [DONE] | 已支持 sessionId 过滤 + heartbeat | `packages/core/src/server/routes/events.ts` |
| CLI/TUI | 客户端消费 SSE/事件流 | [WIP] | 有大量 TUI 组件与事件流 context，但仍需统一"协议/事件 schema"与回放 | `packages/core/src/cli/tui/**` |
| 会话（Session） | 会话状态/历史/压缩 | [WIP] | Session/Storage 已存在；Environment 可选 createSession/getSession/listSessions/updateSession/deleteSession，BaseEnvironment 委托 core/session；与"可回放/可审计"尚未统一 | `packages/core/src/core/session/**`、`.../environment/index.ts`、`.../base/base-environment.ts` |
| OS Env | 本地工作目录/环境变量/路径安全 | [DONE] | `OsEnv` 已具备，并注册 OS tools | `packages/core/src/core/environment/expend/os/os-env.ts` |
| OS Tools | bash/file/glob/grep 等 | [DONE] | OS tools 已存在，带测试用例 | `packages/core/src/core/environment/expend/os/tools/**` |
| 治理（超时/重试/并发） | 统一策略入口（per-tool override） | [WIP] | manager 已存在；需要补齐"策略可配置/可观测/可回放"的闭环 | `packages/core/src/core/environment/base/{timeout,retry,concurrency}.ts` |
| 可靠性（恢复） | tool error recovery / fallback | [WIP] | 有 `recovery.ts` 但需定义清晰策略与事件 | `.../base/recovery.ts` |
| Metrics | 可观测指标采集 | [WIP] | metrics collector 已存在但需接入端到端展示/导出 | `.../base/metrics.ts` |
| 环境事件机制 | EnvEvent 类型定义 + EventTypes 常量 | [WIP] | 设计文档已创建：预定义事件类型（user_query, session.*, background_task.*, tool.*, stream.*）、EventBus 统一入口 + Rule 路由 + Queue、EventHandlerAgent 无状态处理 | `docs/environment-event-mechanism.md`、`core/types/event.ts` |
| 环境事件机制 | Session Route 事件化改造 | [TODO] | 改造 `/sessions/:id/prompt` route，只产生 user_query event，由 EventBus 统一处理 | `server/routes/sessions.ts` |
| 环境事件机制 | EventHandlerAgent 实现 | [TODO] | new 无状态 agent 处理事件，构造 3 条消息插入 session history，触发 handle_query 执行 | `core/agent/event-handler-agent.ts` |
| 环境事件机制 | StreamEvent 通过 EventBus 发布 | [TODO] | 现有 emitStreamEvent 保持不变，同时通过 EventBus publish 供其他订阅者使用 | `core/environment/base/invoke-llm.ts` |
| MCP | 连接/发现/将 MCP tool 装配进 env | [WIP] | 已有 Env 协议 JSON 规范与 Env client/server 封装雏形，下一步接入真实 MCP client/server 传输层 | `packages/core/env_spec/**` |
| Skills | 从目录/配置加载技能→注册为工具 | [TODO] | 目前未形成技能加载与隔离体系 | （待创建） |
| Sub-agents | TaskTool 与 SubAgent 实现 | [DONE] | 设计文档已创建：TaskTool 参数定义、SubAgent Manager、后台任务执行、事件集成机制 | `docs/task-tool-subagent-design.md` |
| Sub-agents | 子代理编排、权限收敛、并行探索 | [TODO] | 设计文档已创建，实现需按 Phase 1-4 逐步落地 | `docs/task-tool-subagent-design.md` |
| Env 原生接口 | 运行日志查询、事件回放、审计查询 | [TODO] | 目前主要是 console log + SSE 推送，没有统一查询接口 | （待创建） |
| 安全 | 参数脱敏、权限模型、审计记录 | [TODO] | 需要设计并与 handle_action 集成 | （待创建） |

---


## 4. 里程碑（Milestones）

> 里程碑不是"愿望清单"，每个里程碑都应有可验收交付物（API/事件/测试/示例）。

### M0：基础可用（已达成）

- Environment/Agent 主干跑通（LLM + tools）
- Server 侧事件总线 + SSE
- OS Env + 基础工具

### M1：配置与可观测闭环（当前阶段）

- 配置系统：用户级配置（Global）+ 环境变量扩展
- 配置状态持久化：模型选择（recent/favorite/variant）
- 统一事件 schema（客户端/服务端一致）与版本化
- 标准化运行日志（结构化）并提供查询/订阅接口
- 任务级"运行记录导出"（最小可回放：messages + tool calls/results + 关键 env 事件）

### M2：能力装配（MCP / Skills）

- MCP：连接、发现 tools、装配为 env tools（含命名/分类/权限策略）
- Skills：加载/注册/版本化/隔离（以 tools 形式暴露）
- 给出可运行示例：1 个 MCP server + 1 个 skill 包 + 1 个 demo agent

### M3：Sub-agents（并行与分工）

- 子代理创建/路由/权限收敛（子代理 tool 白名单）
- 子代理事件流合并（主 agent 可订阅）
- 给出并行探索示例（例如：并行扫描代码 + 并行验证）

### M4：可靠性与安全（可上线前提）

- 策略系统化：超时/并发/重试/熔断/降级（并可观测）
- 权限与审计：敏感参数脱敏、路径/命令白名单、审计日志可检索

---


## 5. 近期待办（Next Actions，按优先级）

> 写法要求：每条都要"可执行 + 可验收"。避免泛泛而谈。

~~1) **配置系统 Phase 1：基础配置系统**~~ ✅ 已完成
~~- 交付物：创建 `packages/core/src/config/` 目录，实现 paths.ts、source.ts、registry.ts、types.ts、merge.ts、sources/global.ts、loader.ts、default-sources.ts~~
~~- 验收：`loadConfig()` 能正确加载 `~/.config/tong_work/agent-core/tong_work.jsonc`，并合并环境变量覆盖~~

~~2) **配置系统 Phase 2：状态持久化**~~ ✅ 已完成
~~- 交付物：实现 `state/model-store.ts`，支持 recent/favorite/variant 的增删改查与文件持久化~~
~~- 验收：模型选择持久化到 `~/.local/state/tong_work/agent-core/model.json`，重启后能恢复~~

~~3) **配置系统 Phase 3：集成到 Environment**~~ ✅ 已完成
~~- 交付物：`BaseEnvironment` 集成配置加载，配置能正确注入 LLM/治理策略/Session~~
~~- 验收：通过配置文件和环境变量能控制 Agent 行为~~

1) **Environment 事件机制实现**（新增）
- 交付物：
  - `core/types/event.ts`：新增 `EnvEvent` 类型 + `EventTypes` 常量
  - `server/eventbus/bus.ts`：改造为统一入口 + Rule 路由 + Queue + AgentHandler 支持
  - `server/environment.ts`：注册默认 rules + 暴露 `publishEvent`
  - `server/routes/sessions.ts`：改造 `/prompt` route 只产生 event
  - `core/agent/event-handler-agent.ts`：无状态 EventHandlerAgent 类
  - `core/environment/base/invoke-llm.ts`：StreamEvent 通过 EventBus publish
- 验收：
  - POST /sessions/:id/prompt 产生 user_query event 并由 EventBus 处理
  - background_task.completed event 能触发 EventHandlerAgent 处理
  - 伪造消息正确插入 session history 并触发 agent 执行

4) **统一事件协议与版本**（M1）
- 交付物：在 `core/types/event.ts`（或等价位置）确定客户端/服务端统一事件 schema + version 字段
- 验收：TUI 能消费 server SSE 的事件，且通过 schema 校验

5) **Environment 原生日志接口最小闭环**（M1）
- 交付物：定义 `env.getLogs(...)` / `env.subscribeLogs(...)`（或等价）+ 基础实现
- 验收：同一份结构化日志可在 CLI、Server、测试环境获取；并能关联 session/message/toolCallId

---


## 6. 决策记录（简版）

- 2026-02-10：将 **Environment** 明确为统一运行时上下文实体，并以 `docs/environment-design-philosophy.md` 作为对外设计目标描述；本文件作为进展与路线图入口。
- 2026-02-12：新增 **配置系统设计**（`docs/config-design.md`），采用用户级配置（Global）+ 环境变量扩展，去掉项目绑定，更适合 tong_work "企业任务自主推进系统"定位。
- 2026-02-12：完成 **配置系统 Phase 1-3** 实现：`packages/core/src/config/` 目录创建，包含完整的配置加载、合并、状态持久化（ModelStore）能力，并集成到 `BaseEnvironment`。
- 2026-02-12：澄清 **Environment 配置概念**：Environment 指的是 **Agent 运行时上下文**（如 OsEnv），不是部署环境（dev/staging/prod）。配置系统支持从 `environments/{os_env|web_env}/` 目录加载 Agent 运行时环境的配置，包含 Agents、Models、Profiles 等配置。
- 2026-02-12：新增 **配置开发手册**（`docs/config-development-guide.md`），提供详细的配置项添加流程、技术实现细节和最佳实践。
- 2026-02-12：新增 **Auth 认证配置系统**：支持 `~/.local/share/tong_work/agent-core/auth.json` 存储 Provider API Keys，包含 `Auth_get()`, `Auth_getApiKey()`, `Auth_setProvider()` 等 API，与主配置分离以提高安全性。
- 2026-02-12：新增 **变量引用解析系统**：支持在配置文件中使用 `${auth:provider-name}` 引用 auth.json 中的认证信息，或使用 `${ENV_VAR}` 引用环境变量，在配置加载时自动解析。
- 2026-02-12：新增 **Connect Command**：实现 `/connect` 命令，允许用户通过 TUI dialog 配置 LLM Provider 的 API Key，支持查看内置 providers（Anthropic/OpenAI/Google/DeepSeek/ZhipuAI/Kimi）、添加自定义 provider、设置 API Key，存储到 `auth.json`。包含 server 端 command 实现和 TUI dialog 组件。
- 2026-02-13：新增 **Models Command**：实现 `/models` 命令，允许用户通过 TUI dialog 选择和管理 LLM 模型。支持：模型浏览（按 Provider 分组）、搜索过滤、键盘导航（↑↓/Enter/Esc/F）、收藏功能、最近使用记录。集成 ModelStore 和 ServerEnvironment，支持模型切换时实时重新初始化 LLM。
- 2026-02-13：新增 **Command 开发指南**（`docs/command-development-guide.md`）：详细记录 Command 的完整开发流程，包括后端实现、前端 Dialog 实现、常见问题及解决方案。以前端 Dialog 开发的关键指导原则为核心，如：使用 ref 获取 input 值、键盘处理函数返回 boolean、createMemo 处理过滤列表等。
- 2026-02-13：新增 **Models 配置加载功能**：支持从 `environments/{env}/models.jsonc` 配置文件加载模型列表，优先级：Environment models > Provider config > Built-in defaults。创建 `models-config.ts` 模块提供 `ModelsConfig_getAll()`、`ModelsConfig_getFromEnvironment()` 等 API，models command 现在优先使用配置中的模型列表。
- 2026-02-16：新增 **Environment 事件机制设计**（`docs/environment-event-mechanism.md`）：通过 EventBus 统一入口 + Rule 路由机制，让 Environment 产生的事件可被 Agent 感知并插入 LLM 消息上下文。核心组件：EnvEvent 类型定义、EventHandlerAgent 无状态处理、Session Route 事件化改造。支持场景：异步任务完成事件、环境变化观测、工具执行错误等。
