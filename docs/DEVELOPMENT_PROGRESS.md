# Agent Core 开发进度与路线图（Progress & Roadmap）

> 目的：这是一份 **长期维护的“进展参照文档”**。团队成员只需要看它，就能知道我们沿着设计目标前进了多少、当前短板是什么、接下来优先做什么。

- **设计目标（必读）**：[`docs/environment-design-philosophy.md`](./environment-design-philosophy.md)
- **历史设计稿（参考）**：`docs/old/`（见 [`docs/README.md`](./README.md)）

---

## 1. 更新约定（如何维护这份文档）

- **更新时机**：每次合入“影响 Environment/Agent 运行时能力”的变更（tools/mcp/skills/事件/会话/可靠性/安全策略）都要更新本文件。
- **更新内容**：
  - 在「能力矩阵」里修改状态与备注（附上关键代码路径）
  - 在「近期待办」里增加/关闭条目（尽量可执行、可验收）
  - 如有关键设计变更，在「决策记录」补一条
- **更新时间**：在文档顶部附近加一行 `最后更新：YYYY-MM-DD`

最后更新：2026-02-10

---

## 2. 当前进度快照（结论前置）

### 2.1 已经具备的主干能力（可用/可演示）

- **Environment 核心骨架**：`Environment` 接口、`BaseEnvironment`（工具注册、prompt 仓库、handle_action、stream hook 等）
- **LLM 调用与流式事件**：`invoke_llm` + `onStreamEvent` hook 打通
- **Server 侧事件总线与 SSE**：EventBus 发布订阅 + `/events` SSE 推送
- **OS 环境与基础工具**：`OsEnv` + bash/file 等工具（并配置默认超时/并发/重试）

### 2.2 明显缺口（尚未体系化/尚未落地）

- **MCP 集成**：尚无统一“连接/发现/装配为工具”的实现
- **Skills 体系**：尚无“技能包加载→注册为工具→版本化/隔离”的实现
- **Sub-agents**：尚无子代理编排与权限收敛机制
- **Environment 原生接口**（日志查询、事件回放、工件/资源管理、审计查询等）：目前仅有事件推送的部分链路

---

## 3. 能力矩阵（按设计目标对齐）

状态标记：
- **[DONE]**：已落地，且有明确入口可复用
- **[WIP]**：已开始，有部分能力但不完整/不稳定
- **[TODO]**：未开始或仅有零散代码，不成体系

| 能力域 | 目标能力 | 状态 | 现状/备注 | 关键代码路径（示例） |
|---|---|---|---|---|
| Environment 核心 | 统一运行时上下文（prompt/tools/事件/策略入口） | [DONE] | `Environment` + `BaseEnvironment` 已形成骨架 | `packages/core/src/core/environment/index.ts`、`.../base/base-environment.ts` |
| Prompt | prompt 仓库、system prompt 注入 | [DONE] | `prompts: Map` + `addPrompt/getPrompt`（BaseEnvironment 内） | `.../base/base-environment.ts` |
| Tools | 工具注册/列举/执行统一入口 | [DONE] | `registerTool/getTools/handle_action`（BaseEnvironment） | `.../base/base-environment.ts` |
| LLM | invoke_llm 作为工具 + stream hook | [DONE] | 流式事件通过 `onStreamEvent` 向上抛 | `.../base/invoke-llm.ts`、`.../base/base-environment.ts` |
| 事件（统一流） | LLM + Tool 生命周期事件标准化 | [DONE] | `StreamEvent` 类型已定义，hook 已接入 | `packages/core/src/core/environment/index.ts` |
| Server 事件总线 | publish/subscribe，支持 session scope | [DONE] | bus + global broadcast 已落地 | `packages/core/src/server/eventbus/*` |
| SSE 推送 | `/events` 推送 EventBus 事件 | [DONE] | 已支持 sessionId 过滤 + heartbeat | `packages/core/src/server/routes/events.ts` |
| CLI/TUI | 客户端消费 SSE/事件流 | [WIP] | 有大量 TUI 组件与事件流 context，但仍需统一“协议/事件 schema”与回放 | `packages/core/src/cli/tui/**` |
| 会话（Session） | 会话状态/历史/压缩 | [WIP] | 存在 session 模块与 compaction，但与“可回放/可审计”尚未统一 | `packages/core/src/core/session/**` |
| OS Env | 本地工作目录/环境变量/路径安全 | [DONE] | `OsEnv` 已具备，并注册 OS tools | `packages/core/src/core/environment/expend/os/os-env.ts` |
| OS Tools | bash/file/glob/grep 等 | [DONE] | OS tools 已存在，带测试用例 | `packages/core/src/core/environment/expend/os/tools/**` |
| 治理（超时/重试/并发） | 统一策略入口（per-tool override） | [WIP] | manager 已存在；需要补齐“策略可配置/可观测/可回放”的闭环 | `packages/core/src/core/environment/base/{timeout,retry,concurrency}.ts` |
| 可靠性（恢复） | tool error recovery / fallback | [WIP] | 有 `recovery.ts` 但需定义清晰策略与事件 | `.../base/recovery.ts` |
| Metrics | 可观测指标采集 | [WIP] | metrics collector 已存在但需接入端到端展示/导出 | `.../base/metrics.ts` |
| MCP | 连接/发现/将 MCP tool 装配进 env | [TODO] | 目前代码中无系统性 MCP 入口 | （待创建） |
| Skills | 从目录/配置加载技能→注册为工具 | [TODO] | 目前未形成技能加载与隔离体系 | （待创建） |
| Sub-agents | 子代理编排、权限收敛、并行探索 | [TODO] | 目前未看到 sub-agent 相关实现 | （待创建） |
| Env 原生接口 | 运行日志查询、事件回放、审计查询 | [TODO] | 目前主要是 console log + SSE 推送，没有统一查询接口 | （待创建） |
| 安全 | 参数脱敏、权限模型、审计记录 | [TODO] | 需要设计并与 handle_action 集成 | （待创建） |

---

## 4. 里程碑（Milestones）

> 里程碑不是“愿望清单”，每个里程碑都应有可验收交付物（API/事件/测试/示例）。

### M0：基础可用（已达成）

- Environment/Agent 主干跑通（LLM + tools）
- Server 侧事件总线 + SSE
- OS Env + 基础工具

### M1：可观测闭环（下一阶段重点）

- 统一事件 schema（客户端/服务端一致）与版本化
- 标准化运行日志（结构化）并提供查询/订阅接口
- 任务级“运行记录导出”（最小可回放：messages + tool calls/results + 关键 env 事件）

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

> 写法要求：每条都要“可执行 + 可验收”。避免泛泛而谈。

1) **统一事件协议与版本**（M1）
- 交付物：在 `core/types/event.ts`（或等价位置）确定客户端/服务端统一事件 schema + version 字段
- 验收：TUI 能消费 server SSE 的事件，且通过 schema 校验

2) **Environment 原生日志接口最小闭环**（M1）
- 交付物：定义 `env.getLogs(...)` / `env.subscribeLogs(...)`（或等价）+ 基础实现
- 验收：同一份结构化日志可在 CLI、Server、测试环境获取；并能关联 session/message/toolCallId

3) **任务级运行记录导出（可回放雏形）**（M1）
- 交付物：可导出本次任务的记录（messages、tool calls/results、stream events）
- 验收：给定记录可重建 UI 展示时间线（不要求完全重放执行）

4) **MCP 装配为工具的最小实现**（M2）
- 交付物：`McpClient`（或等价）+ “list tools → registerTool” 的装配流程
- 验收：接入一个 MCP server 后，Agent 可见并可调用其工具

5) **Skills 加载与注册**（M2）
- 交付物：从目录加载 `SKILL.md`/脚本（按约定）→ 注册为 tool（含描述与参数 schema）
- 验收：技能作为工具出现于 tool 列表，且可被调用并产生事件

---

## 6. 决策记录（简版）

- 2026-02-10：将 **Environment** 明确为统一运行时上下文实体，并以 `docs/environment-design-philosophy.md` 作为对外设计目标描述；本文件作为进展与路线图入口。

