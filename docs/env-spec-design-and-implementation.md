# Env Spec 设计与实现

本文档描述 **Env MCP 协议** 在 agent-core 中的设计目标、核心抽象与实现逻辑，以及如何从 Environment 实例直接推导 MCP Server 的 options，并支持 Stdio / HTTP 两种传输层。

---

## 1. 设计目标

- **以 Environment 为中心**：MCP Server 所需的「环境描述、Profiles、Agents、日志」等能力，优先从 **core 的 Environment 接口** 表达；env_spec 层只做协议适配与推导，不引入独立于 core 的 capability 接口。
- **从 env 实例推导 options**：调用方只需提供 `Environment`（或满足最小接口的 `EnvOptionsSource`）和可选的 `BaseEnvMeta`，即可通过 `createBaseEnvMcpServerOptions(env, meta)` 得到完整的 `EnvServerOptions`，无需手写 describeEnv、listProfiles、listAgents、getAgent、queryLogs。
- **传输层与业务解耦**：与 info_feed_mcp 同构——业务层只定义「如何处理 request、如何返回响应」；传输层使用 MCP SDK 的 Stdio / Streamable HTTP，由调用方 `server.connect(transport)` 决定。

---

## 2. 架构边界

| 层级 | 职责 | 关键类型/入口 |
|------|------|----------------|
| **core (Environment)** | 定义「环境」的通用能力；可选扩展 getProfiles、queryLogs、session 增删改查，与 env spec 结构兼容 | `Environment`, `BaseEnvironment`, `EnvironmentProfile`, `EnvironmentLogEntry`，Session 相关类型来自 `core/session` |
| **env_spec (base_env)** | 从 env 推导 EnvDescription、EnvProfile 列表；仅依赖 core 的 getPrompt、getTools、getProfiles、queryLogs | `EnvOptionsSource`, `createBaseEnvDescription`, `createBaseEnvProfiles`, `BaseEnvMeta` |
| **env_spec (server)** | 将 EnvServerOptions 挂到 MCP Server；从 env 构造 options | `EnvMCPServer`, `createBaseEnvMcpServerOptions`, `createEnvMcpServer` |
| **env_spec (client)** | 对 env/* tools 做类型安全封装 | `EnvClient`, `createEnvClient`, `StdioClientTransport`, `StreamableHTTPClientTransport` |

env_spec **不** 再定义独立的「BaseEnvSpecCapability / BaseEnvironmentLike」；所有推导仅依赖 core 的 `Environment` 及其可选方法。

---

## 3. Core 层：Environment 接口扩展

### 3.1 新增类型（与 env spec 结构兼容，避免 core 依赖 env_spec）

定义于 `packages/core/src/core/environment/index.ts`：

- **EnvironmentAgentSpec**：id, role, promptId?, promptOverride?, allowedTools?, deniedTools?, metadata?
- **EnvironmentProfile**：id, displayName, primaryAgents, subAgents?, metadata?
- **EnvironmentLogLevel**：`"debug" | "info" | "warn" | "error"`
- **EnvironmentLogEntry**：timestamp, level, message, sessionId?, agentId?, toolName?, context?
- **EnvironmentQueryLogsParams**：sessionId?, agentId?, level?, since?, until?, limit?

### 3.2 Environment 可选方法

- **getProfiles?(): EnvironmentProfile[] | Promise<EnvironmentProfile[]>**  
  未实现时，由 env_spec 的 `createBaseEnvProfiles(env, meta)` 根据 `getPrompt("system")` 与 `getTools()` 推导默认单一 profile。
- **queryLogs?(params: EnvironmentQueryLogsParams): Promise<EnvironmentLogEntry[]>**  
  未实现则不暴露 MCP 的 query_logs，且 `capabilities.logs === false`。

### 3.3 BaseEnvironment 实现（profiles / logs）

- **getProfiles()**：默认实现返回一个 profile（id: `"default"`），一个 primary agent（id: `"default"`），`promptId` 取自是否存在 `getPrompt("system")`，`allowedTools` 取自 `listTools()` 的工具名。子类可覆盖以提供多 profile。
- **queryLogs**：不实现；子类若有日志能力可自行实现。

### 3.4 Session 管理（Environment 可选接口）

Session 能力通过 Environment 接口暴露，类型复用 **core/session** 的 `Session`、`SessionCreateOptions`（core/environment 仅做 type 引用，不依赖 env_spec）。定义于 `packages/core/src/core/environment/index.ts`：

- **createSession?(options?: SessionCreateOptions): Session | Promise<Session>** — 创建会话
- **getSession?(id: string): Session | undefined | Promise<Session | undefined>** — 按 id 获取会话
- **listSessions?(): Session[] | Promise<Session[]>** — 列出所有会话
- **updateSession?(id: string, payload: { title?: string; metadata?: Record<string, unknown> }): void | Promise<void>** — 更新会话标题或 metadata
- **deleteSession?(id: string): void | Promise<void>** — 删除会话

未实现上述方法的 env 视为无 session 能力；MCP 侧若需暴露 session 增删改查，可据此挂载 env/* session 类 tools。

### 3.5 BaseEnvironment 的 Session 实现

BaseEnvironment 实现上述 5 个 session 方法，**委托给 core/session 的 `Session` 与 `Storage`**（不新增实现类）：

- `createSession(options)` → `Session.create(options)`
- `getSession(id)` → `Session.get(id)`
- `listSessions()` → `Session.list()`
- `updateSession(id, payload)` → 取 `Session.get(id)` 后调用 `setTitle` / `setMetadata`
- `deleteSession(id)` → `Session.get(id)?.delete()`

子类可覆盖以接入其他 session 存储（如持久化）；若需全新实现机制，可通过升级 env（例如新子类）使用。

---

## 4. env_spec 层：推导逻辑

### 4.1 EnvOptionsSource（最小可推导接口）

定义于 `packages/core/src/env_spec/base_env/index.ts`：

```ts
type EnvOptionsSource = Pick<Environment, "getPrompt" | "getTools"> &
  Partial<Pick<Environment, "getProfiles" | "queryLogs">>;
```

- 完整 `Environment` 或 `BaseEnvironment` 自然满足。
- 测试/示例中可用仅实现 getPrompt、getTools、可选 getProfiles/queryLogs 的轻量对象。

### 4.2 createBaseEnvProfiles(env, meta)

- 若 `env.getProfiles` 存在且同步返回数组：直接使用其返回值（类型断言为 EnvProfile[]）。
- 否则：用 `env.getTools()` 与 `env.getPrompt("system")` 构造单一默认 profile（与 BaseEnvironment.getProfiles() 的默认行为一致）。

### 4.3 createBaseEnvDescription(env, meta, profiles?)

- 若传入 `profiles` 则使用；否则调用 `createBaseEnvProfiles(env, meta)`。
- `capabilities.logs` 取 `typeof env.queryLogs === "function"`。
- 其他能力（events, metrics, profiles）固定为 true。

### 4.4 createBaseEnvMcpServerOptions(env, meta)

- **getProfiles**：若 `env.getProfiles` 存在则 `await Promise.resolve(env.getProfiles())`，否则 `createBaseEnvProfiles(env, meta)`。
- **describeEnv**：`async () => createBaseEnvDescription(env, meta, await getProfiles())`。
- **listProfiles**：即上述 getProfiles。
- **listAgents / getAgent**：从 getProfiles() 得到的 profiles 扁平化/按 profileId、role 过滤。
- **queryLogs**：仅当 `env.queryLogs` 存在时挂载，直接委托给 `env.queryLogs`。

由此，**所有 MCP Server 的 options 均可从 env 实例推导**，无需在 env_spec 中维护单独的 capability 类型。

---

## 5. 传输层

### 5.1 Stdio（默认）

- **Server**：`new EnvMCPServer(options)` 后 `server.connect(new StdioServerTransport())`；或 `createEnvMcpServer(server, env, meta)` 再 connect(transport)。
- **Client**：`new StdioClientTransport({ command: "bun", args: ["run", serverScript] })`，再 `createEnvClient(transport)`。  
  不设 `ENV_MCP_HTTP_URL` 时，`env-client-test.ts` 即采用此方式并 spawn 子进程。

### 5.2 HTTP 远程（Streamable HTTP）

- **Server**：使用 `WebStandardStreamableHTTPServerTransport`，并配置 **stateful 模式**（`sessionIdGenerator: () => crypto.randomUUID()`），避免「stateless transport 不可跨请求复用」错误。  
  `Bun.serve({ fetch: (req) => transport.handleRequest(req), port })` 暴露 HTTP。
- **Client**：设置环境变量 `ENV_MCP_HTTP_URL`（如 `http://localhost:3000`），`env-client-test.ts` 使用 `StreamableHTTPClientTransport(new URL(url))`，同样通过 `createEnvClient(transport)` 跑同一套集成测试。

env_spec 仅 re-export SDK 的传输类（`StdioServerTransport` / `StdioClientTransport`，`WebStandardStreamableHTTPServerTransport` / `StreamableHTTPClientTransport`），不实现传输细节。

---

## 6. 示例与用法

| 示例 | 说明 |
|------|------|
| **env-mcp-server.ts** | 手写 EnvServerOptions（mock describeEnv、listProfiles、queryLogs、listAgents、getAgent），Stdio 传输。 |
| **env-mcp-server-from-env.ts** | 完全从 env 推导：实现 `EnvOptionsSource`（getPrompt、getTools、getProfiles、queryLogs），调用 `createBaseEnvMcpServerOptions(env, meta)` 得到 options，无手写 overrides。 |
| **env-mcp-server-http.ts** | 与 env-mcp-server 同构的 options，传输层改为 WebStandardStreamableHTTPServerTransport + Bun.serve，stateful session。 |
| **env-client-test.ts** | 集成测试：默认 Stdio（spawn server 脚本）；若设 `ENV_MCP_HTTP_URL` 则用 HTTP 连接已启动的 server，执行同一组 getDescription、listProfiles、getProfile、listAgents、getAgent、queryLogs 等测试。 |

### 6.1 从 env 推导并启动（Stdio）

```ts
const options = createBaseEnvMcpServerOptions(env, { id: "my-env", displayName: "My Env", version: "1.0.0" });
const server = new EnvMCPServer(options);
await server.connect(new StdioServerTransport());
```

### 6.2 从 env 推导并启动（HTTP）

```ts
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});
await server.connect(transport);
Bun.serve({ port: 3000, fetch: (req) => transport.handleRequest(req) });
```

### 6.3 Client 测试（HTTP 远程）

```bash
ENV_MCP_HTTP_URL=http://localhost:3000 bun run examples/env-client-test.ts
```

---

## 7. 小结

- **Core**：通过扩展 `Environment` 的可选方法（getProfiles、queryLogs、**createSession / getSession / listSessions / updateSession / deleteSession**）及与 env spec 兼容的类型，使「从 env 推导 MCP options」完全建立在 core 上；session 能力暴露在 Environment 接口上，类型复用 `core/session`。
- **BaseEnvironment**：getProfiles 默认推导；session 五方法委托给 `Session`、`Storage`，子类可覆盖以换用其他 session 实现。
- **env_spec**：只依赖 `Environment` / `EnvOptionsSource`，用 `createBaseEnvProfiles`、`createBaseEnvDescription`、`createBaseEnvMcpServerOptions` 从 env 实例推导出完整 EnvServerOptions；不保留 BaseEnvSpecCapability / BaseEnvironmentLike。
- **传输**：Stdio 与 Streamable HTTP 均由 MCP SDK 提供，env_spec 仅导出并选用；HTTP 服务端需使用 stateful transport（sessionIdGenerator）以支持多请求。

相关代码入口：

- Core：`packages/core/src/core/environment/index.ts`，`packages/core/src/core/environment/base/base-environment.ts`
- Session（复用）：`packages/core/src/core/session/index.ts`，`session.ts`，`storage.ts`，`types.ts`
- env_spec：`packages/core/src/env_spec/base_env/index.ts`，`packages/core/src/env_spec/server.ts`，`packages/core/src/env_spec/client.ts`
- 示例：`examples/env-mcp-server-from-env.ts`，`examples/env-mcp-server-http.ts`，`examples/env-client-test.ts`
