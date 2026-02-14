# OpenCode MCP 实现文档

## 1. MCP 机制概述

OpenCode 的 MCP (Model Context Protocol) 机制是一个完整的客户端实现，支持连接本地和远程 MCP 服务器，并将其工具自动暴露给 LLM 使用。

## 2. 核心文件结构

```
thirdparty/opencode/packages/opencode/src/
├── mcp/
│   ├── index.ts          # MCP 核心实现（连接管理、工具转换、状态管理）
│   ├── auth.ts           # OAuth 凭证存储与管理
│   ├── oauth-provider.ts # OAuth 认证流程实现
│   └── oauth-callback.ts # OAuth 回调服务器
├── config/
│   └── config.ts         # 配置定义与读取（MCP 配置Schema定义）
├── cli/cmd/
│   └── mcp.ts            # MCP 命令行工具（add/list/auth/logout/debug）
└── server/routes/
    └── mcp.ts            # MCP 服务端API路由
```

## 3. MCP SDK 的使用

### 3.1 使用的 SDK 包

**文件**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\package.json`

```json
"@modelcontextprotocol/sdk": "1.25.2"
```

### 3.2 SDK 模块导入

**文件**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\mcp\index.ts` (行 1-11)

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js"
import { CallToolResultSchema, type Tool as MCPToolDef, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js"
```

### 3.3 SDK 提供的传输层

OpenCode 使用 SDK 提供的三种传输层来连接 MCP 服务器：

| 传输层 | SDK 模块 | 用途 | 代码位置 |
|--------|---------|------|----------|
| `StdioClientTransport` | `client/stdio.js` | 连接本地 MCP 服务器 | `mcp/index.ts:411-421` |
| `StreamableHTTPClientTransport` | `client/streamableHttp.js` | 连接远程 MCP (HTTP) | `mcp/index.ts:331-335` |
| `SSEClientTransport` | `client/sse.js` | 连接远程 MCP (SSE) | `mcp/index.ts:337-342` |

**本地 MCP 连接实现** (`mcp/index.ts:408-450`):
```typescript
if (mcp.type === "local") {
  const [cmd, ...args] = mcp.command
  const cwd = Instance.directory
  const transport = new StdioClientTransport({
    stderr: "pipe",
    command: cmd,
    args,
    cwd,
    env: {
      ...process.env,
      ...(cmd === "opencode" ? { BUN_BE_BUN: "1" } : {}),
      ...mcp.environment,
    },
  })

  const client = new Client({
    name: "opencode",
    version: Installation.VERSION,
  })
  await withTimeout(client.connect(transport), connectTimeout)
  registerNotificationHandlers(client, key)
  mcpClient = client
}
```

**远程 MCP 连接实现** (`mcp/index.ts:304-405`):
```typescript
if (mcp.type === "remote") {
  // OAuth 认证（默认启用）
  const authProvider = new McpOAuthProvider(key, mcp.url, oauthConfig)

  // 依次尝试两种传输方式
  const transports = [
    {
      name: "StreamableHTTP",
      transport: new StreamableHTTPClientTransport(new URL(mcp.url), {
        authProvider,
        requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
      }),
    },
    {
      name: "SSE",
      transport: new SSEClientTransport(new URL(mcp.url), {
        authProvider,
        requestInit: mcp.headers ? { headers: mcp.headers } : undefined,
      }),
    },
  ]

  // 按序尝试连接，成功则停止
  for (const { name, transport } of transports) {
    try {
      const client = new Client({ name: "opencode", version: Installation.VERSION })
      await withTimeout(client.connect(transport), connectTimeout)
      mcpClient = client
      break
    } catch (error) {
      // 处理连接失败
    }
  }
}
```

### 3.4 SDK 的 OAuth 认证支持

SDK 内置了完整的 OAuth 认证逻辑，OpenCode 通过实现 `OAuthClientProvider` 接口来提供存储能力：

**SDK 提供的 OAuth 接口** (`mcp/oauth-provider.ts:1-7`):
```typescript
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformation,
  OAuthClientInformationFull,
} from "@modelcontextprotocol/sdk/shared/auth.js"
```

**SDK `OAuthClientProvider` 接口方法**:
| 方法 | 功能 |
|------|------|
| `clientMetadata` getter | 返回客户端元数据（用于动态注册） |
| `clientInformation()` | 获取已注册或动态注册的客户端信息 |
| `saveClientInformation()` | 保存动态注册的客户端信息 |
| `tokens()` | 获取存储的访问令牌 |
| `saveTokens()` | 保存访问/刷新令牌 |
| `saveCodeVerifier()` / `codeVerifier()` | PKCE code verifier 支持 |
| `redirectToAuthorization()` | 授权重定向回调 |

**OpenCode 实现** (`mcp/oauth-provider.ts:26-152`):
```typescript
export class McpOAuthProvider implements OAuthClientProvider {
  constructor(
    private mcpName: string,
    private serverUrl: string,
    private config: McpOAuthConfig,
    private callbacks: McpOAuthCallbacks,
  ) {}

  // 获取令牌
  async tokens(): Promise<OAuthTokens | undefined> {
    const entry = await McpAuth.getForUrl(this.mcpName, this.serverUrl)
    if (!entry?.tokens) return undefined
    return {
      access_token: entry.tokens.accessToken,
      token_type: "Bearer",
      refresh_token: entry.tokens.refreshToken,
      expires_in: entry.tokens.expiresAt ? Math.floor(entry.tokens.expiresAt - Date.now() / 1000) : undefined,
      scope: entry.tokens.scope,
    }
  }

  // 保存令牌
  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await McpAuth.updateTokens(
      this.mcpName,
      { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: tokens.expires_in ? Date.now() / 1000 + tokens.expires_in : undefined, scope: tokens.scope },
      this.serverUrl,
    )
  }

  // 其他方法实现...
}
```

### 3.5 SDK 类型定义的使用

**文件**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\mcp\index.ts` (行 120-148)

MCP 工具转换为 AI SDK Tool:
```typescript
async function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Promise<Tool> {
  const inputSchema = mcpTool.inputSchema
  const schema: JSONSchema7 = {
    ...(inputSchema as JSONSchema7),
    type: "object",
    properties: (inputSchema.properties ?? {}) as JSONSchema7["properties"],
    additionalProperties: false,
  }

  return dynamicTool({
    description: mcpTool.description ?? "",
    inputSchema: jsonSchema(schema),
    execute: async (args: unknown) => {
      return client.callTool(
        { name: mcpTool.name, arguments: (args || {}) as Record<string, unknown> },
        CallToolResultSchema,
        { resetTimeoutOnProgress: true, timeout },
      )
    },
  })
}
```

## 4. 配置读取机制

### 4.1 MCP 配置 Schema 定义

**文件**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\config\config.ts` (行 483-544)

```typescript
// 本地 MCP 服务器配置
export const McpLocal = z.object({
  type: z.literal("local"),
  command: z.string().array(),
  environment: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  timeout: z.number().int().positive().optional(),
})

// OAuth 配置
export const McpOAuth = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  scope: z.string().optional(),
})

// 远程 MCP 服务器配置
export const McpRemote = z.object({
  type: z.literal("remote"),
  url: z.string(),
  enabled: z.boolean().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  oauth: z.union([McpOAuth, z.literal(false)]).optional(),
  timeout: z.number().int().positive().optional(),
})

// 统一配置类型
export const Mcp = z.discriminatedUnion("type", [McpLocal, McpRemote])
```

### 4.2 配置在 Info 中的定义

**文件**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\config\config.ts` (行 1043-1056)

```typescript
mcp: z.record(
  z.string(),
  z.union([
    Mcp,
    z.object({ enabled: z.boolean() })  // 仅启用/禁用远程默认配置
  ]),
).optional()
```

### 4.3 配置加载优先级

**文件**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\config\config.ts` (行 66-183)

配置加载顺序（低优先级 → 高优先级）：
1. 远程 `.well-known/opencode`（组织默认配置）
2. 全局配置 `~/.config/opencode/opencode.json`
3. 自定义配置 `OPENCODE_CONFIG` 环境变量
4. 项目配置 `opencode.json` / `opencode.jsonc`
5. `.opencode` 子目录配置
6. 内联配置 `OPENCODE_CONFIG_CONTENT`
7. 托管配置（企业版最高优先级）

## 5. MCP 核心实现逻辑

### 5.1 MCP 状态管理

**文件**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\mcp\index.ts` (行 163-210)

```typescript
const state = Instance.state(
  async () => {
    const cfg = await Config.get()
    const config = cfg.mcp ?? {}
    const clients: Record<string, MCPClient> = {}
    const status: Record<string, Status> = {}

    await Promise.all(
      Object.entries(config).map(async ([key, mcp]) => {
        if (!isMcpConfigured(mcp)) return
        if (mcp.enabled === false) {
          status[key] = { status: "disabled" }
          return
        }
        const result = await create(key, mcp).catch(() => undefined)
        if (!result) return
        status[key] = result.status
        if (result.mcpClient) {
          clients[key] = result.mcpClient
        }
      }),
    )
    return { status, clients }
  },
  async (state) => {
    await Promise.all(
      Object.values(state.clients).map((client) => client.close())
    )
  }
)
```

### 5.2 工具注册

**文件**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\mcp\index.ts` (行 566-603)

```typescript
export async function tools() {
  const result: Record<string, Tool> = {}
  const s = await state()
  const config = cfg.mcp ?? {}
  
  for (const [clientName, client] of Object.entries(clientsSnapshot)) {
    if (s.status[clientName]?.status !== "connected") continue
    
    const toolsResult = await client.listTools()
    const timeout = mcpConfig.timeout ?? defaultTimeout
    
    for (const mcpTool of toolsResult.tools) {
      // 工具名称格式：{clientName}_{toolName}
      const key = sanitizedClientName + "_" + sanitizedToolName
      result[key] = await convertMcpTool(mcpTool, client, timeout)
    }
  }
  return result
}
```

## 6. OAuth 认证机制

### 6.1 OAuth 凭证存储

**文件**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\mcp\auth.ts` (行 1-133)

OAuth 凭证存储在 `~/.local/share/opencode/mcp-auth.json`:

```typescript
export const Entry = z.object({
  tokens: Tokens.optional(),           // 访问令牌
  clientInfo: ClientInfo.optional(),   // 动态注册的客户端信息
  codeVerifier: z.string().optional(), // PKCE code verifier
  oauthState: z.string().optional(),   // OAuth state 防 CSRF
  serverUrl: z.string().optional(),   // 凭证对应的服务器 URL
})

const filepath = path.join(Global.Path.data, "mcp-auth.json")
```

### 6.2 OAuth 回调服务器

**文件**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\mcp\oauth-callback.ts` (行 1-200)

本地回调服务器监听 `http://127.0.0.1:19876/mcp/oauth/callback`:
- 接收 OAuth 授权码
- 验证 state 参数防止 CSRF
- 返回成功/失败 HTML 页面

## 7. CLI 命令行工具

**文件**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\mcp.ts`

| 命令 | 说明 |
|------|------|
| `opencode mcp add` | 交互式添加 MCP 服务器 |
| `opencode mcp list` | 列出所有 MCP 服务器及状态 |
| `opencode mcp auth <name>` | 启动 OAuth 认证流程 |
| `opencode mcp auth list` | 列出 OAuth 服务器认证状态 |
| `opencode mcp logout <name>` | 移除 OAuth 凭证 |
| `opencode mcp debug <name>` | 调试 OAuth 连接问题 |

## 8. 服务端 API

**文件**: `D:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\server\routes\mcp.ts`

| 端点 | 方法 | 说明 |
|------|------|------|
| `/mcp` | GET | 获取所有 MCP 服务器状态 |
| `/mcp` | POST | 动态添加 MCP 服务器 |
| `/mcp/:name/connect` | POST | 连接 MCP 服务器 |
| `/mcp/:name/disconnect` | POST | 断开 MCP 服务器 |
| `/mcp/:name/auth` | POST | 启动 OAuth 流程 |
| `/mcp/:name/auth/callback` | POST | 完成 OAuth 认证 |
| `/mcp/:name/auth` | DELETE | 移除 OAuth 凭证 |

## 9. MCP 配置示例

### 9.1 配置文件位置

OpenCode 的 MCP 配置**统一放在 `opencode.json` 主配置文件**的 `mcp` 字段中。没有单独的 MCP 配置目录。

配置文件位置（按优先级）：
```
项目根目录/
├── opencode.json          # 项目配置（高优先级）
├── opencode.jsonc         # 项目配置（支持注释）
└── .opencode/
    └── opencode.json      # .opencode 子目录配置

~/.config/opencode/
└── opencode.json          # 全局配置（低优先级）
```

### 9.2 完整配置示例

**项目配置** (`opencode.json` 或 `opencode.jsonc`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    // ========== 本地 MCP 服务器示例 ==========
    "filesystem": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"],
      "enabled": true,
      "timeout": 30000,
      "environment": {
        "DEBUG": "true"
      }
    },
    
    "everything": {
      "type": "local",
      "command": ["bun", "x", "@modelcontextprotocol/server-everything"],
      "enabled": true
    },
    
    // ========== 远程 MCP 服务器示例（无认证）==========
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp",
      "enabled": true,
      "headers": {
        "CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}"
      },
      "timeout": 30000
    },
    
    // ========== 远程 MCP 服务器示例（OAuth 自动发现）==========
    "sentry": {
      "type": "remote",
      "url": "https://mcp.sentry.dev/mcp",
      "oauth": {},
      "enabled": true
    },
    
    // ========== 远程 MCP 服务器示例（预注册 OAuth）==========
    "github-mcp": {
      "type": "remote",
      "url": "https://api.github.com/mcp",
      "oauth": {
        "clientId": "{env:GITHUB_CLIENT_ID}",
        "clientSecret": "{env:GITHUB_CLIENT_SECRET}",
        "scope": "repo read:user"
      },
      "enabled": true
    },
    
    // ========== 远程 MCP 服务器示例（禁用 OAuth）==========
    "api-key-server": {
      "type": "remote",
      "url": "https://mcp.example.com/api",
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:MCP_API_KEY}"
      },
      "enabled": true
    },
    
    // ========== 禁用远程默认配置 ==========
    "jira": {
      "enabled": false
    }
  },
  
  // ========== 工具级别控制 ==========
  "tools": {
    "filesystem_*": true,
    "context7_*": true,
    "sentry_*": false,
    "github-mcp_*": true
  },
  
  // ========== Agent 级别工具控制 ==========
  "agent": {
    "primary": {
      "tools": {
        "sentry_*": true
      }
    }
  },
  
  // ========== 实验性配置 ==========
  "experimental": {
    "mcp_timeout": 60000
  }
}
```

### 9.3 最小配置示例

**简单本地 MCP**:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["npx", "-y", "@modelcontextprotocol/server-filesystem", "./src"]
    }
  }
}
```

**简单远程 MCP**:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp"
    }
  }
}
```

### 9.4 配置字段说明

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `type` | `"local"` / `"remote"` | 是 | MCP 服务器类型 |
| `command` | `string[]` | local 是 | 启动本地 MCP 的命令和参数 |
| `url` | `string` | remote 是 | 远程 MCP 服务器 URL |
| `enabled` | `boolean` | 否 | 是否启用（默认 true） |
| `environment` | `object` | 否 | 本地 MCP 的环境变量 |
| `headers` | `object` | 否 | 远程 MCP 的请求头 |
| `oauth` | `object` / `false` | 否 | OAuth 配置，false 禁用 |
| `oauth.clientId` | `string` | 否 | OAuth 客户端 ID |
| `oauth.clientSecret` | `string` | 否 | OAuth 客户端密钥 |
| `oauth.scope` | `string` | 否 | OAuth  scopes |
| `timeout` | `number` | 否 | 请求超时（毫秒），默认 30000 |

### 9.5 使用 MCP 工具

在 prompt 中使用 MCP 工具：

```
# 使用指定 MCP 的工具
use the filesystem tool to list files in src/

# 使用指定 MCP 的多个工具
use sentry to show me recent errors

# 让 AI 自己选择合适的 MCP 工具
查找 context7 中关于 React hooks 的文档
```

## 10. 开发自己的 MCP 服务器

### 10.1 概述

OpenCode 是 **MCP 客户端**，要使用自己的 MCP 服务，你需要将其实现为 **MCP 服务器端**，然后 OpenCode 通过 `StdioClientTransport` 连接它。

本质就是：你的 JS 脚本通过 stdin/stdout 与 OpenCode 通信，遵循 MCP 协议。

### 10.2 MCP 服务器脚本格式

你的 JS 脚本需要使用 `@modelcontextprotocol/sdk` 实现 MCP 服务器端接口：

**基础示例 - 问候 MCP**:
```javascript
// my-mcp-server.mjs
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

// 定义你的工具
const myTool = {
  name: "greet",
  description: "向用户打招呼",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "用户名" }
    },
    required: ["name"]
  },
}

// 创建服务器
const server = new Server(
  {
    name: "my-mcp-server",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {}
    }
  }
)

// 注册工具列表处理函数
server.setRequestHandler("tools/list", async () => {
  return {
    tools: [myTool]
  }
})

// 注册工具调用处理函数
server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params
  
  if (name === "greet") {
    return {
      content: [
        {
          type: "text",
          text: `Hello, ${args.name}!`
        }
      ]
    }
  }
  
  throw new Error(`Unknown tool: ${name}`)
})

// 启动传输层（关键：通过 stdin/stdout 通信）
const transport = new StdioServerTransport()
await server.connect(transport)
```

### 10.3 完整目录结构示例

```
my-project/
├── opencode.json              # OpenCode 配置文件
└── mcp-servers/               # 你的 MCP 服务目录（可任意命名）
    ├── package.json           # Node 项目配置
    ├── my-greet.mjs          # MCP 服务脚本
    └── .env                   # 环境变量（可选）
```

### 10.4 OpenCode 配置

**opencode.json**:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "my-greet": {
      "type": "local",
      "command": ["node", "./mcp-servers/my-greet.mjs"],
      "enabled": true,
      "environment": {
        "NODE_ENV": "development"
      },
      "timeout": 30000
    }
  }
}
```

或者如果你用 Bun：
```json
{
  "mcp": {
    "my-greet": {
      "type": "local",
      "command": ["bun", "run", "./mcp-servers/my-greet.mjs"]
    }
  }
}
```

### 10.5 需要的依赖

在 `mcp-servers/package.json` 中添加：

```json
{
  "name": "my-mcp-servers",
  "type": "module",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.0.0"
  }
}
```

然后运行：
```bash
cd mcp-servers
npm install
```

### 10.6 复杂示例 - TODO 管理 MCP

```javascript
// todo 一个简单的 TODO 管理-server.mjs - MCP
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"

let todos = []

const server = new Server(
  { name: "todo-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
)

// 工具列表
server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "add_todo",
      description: "添加一个 TODO 项",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "TODO 内容" }
        },
        required: ["text"]
      }
    },
    {
      name: "list_todos",
      description: "列出所有 TODO",
      inputSchema: {
        type: "object",
        properties: {}
      }
    },
    {
      name: "complete_todo",
      description: "标记 TODO 为已完成",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "TODO ID" }
        },
        required: ["id"]
      }
    }
  ]
}))

// 工具调用处理
server.setRequestHandler("tools/call", async (request) => {
  const { name, arguments: args } = request.params
  
  if (name === "add_todo") {
    const id = Date.now().toString()
    todos.push({ id, text: args.text, done: false })
    return {
      content: [{ type: "text", text: `Added: ${args.text} (id: ${id})` }]
    }
  }
  
  if (name === "list_todos") {
    const list = todos.map(t => `[${t.done ? 'x' : ' '}] ${t.id}: ${t.text}`).join('\n')
    return {
      content: [{ type: "text", text: list || "No todos yet" }]
    }
  }
  
  if (name === "complete_todo") {
    const todo = todos.find(t => t.id === args.id)
    if (!todo) {
      return {
        content: [{ type: "text", text: `Todo not found: ${args.id}` }]
      }
    }
    todo.done = true
    return {
      content: [{ type: "text", text: `Completed: ${todo.text}` }]
    }
  }
  
  throw new Error(`Unknown tool: ${name}`)
})

// 启动
const transport = new StdioServerTransport()
await server.connect(transport)
```

配置：
```json
{
  "mcp": {
    "todo": {
      "type": "local",
      "command": ["bun", "run", "./mcp-servers/todo-server.mjs"]
    }
  }
}
```

### 10.7 开发自己的 MCP 服务器要点

| 项目 | 说明 |
|------|------|
| **脚本位置** | 任意位置，只要 command 能找到 |
| **脚本格式** | 使用 MCP SDK 实现 Server 端 |
| **运行命令** | 通过 `command` 数组指定 |
| **连接方式** | `StdioServerTransport` (标准输入输出) |
| **配置位置** | `opencode.json` 的 `mcp` 字段 |
| **核心接口** | `server.setRequestHandler("tools/list", ...)` 和 `server.setRequestHandler("tools/call", ...)` |

### 10.8 使用方式

在 OpenCode 中使用：
```
# 直接调用
add a todo: "Buy milk"
list all todos
complete the todo with id 1234567890
```

## 11. 关键设计要点

1. **传输层支持**: 同时支持 `StreamableHTTP` 和 `SSE` 两种远程传输方式，按序尝试
2. **OAuth 自动发现**: 支持动态客户端注册 (RFC 7591)，无需预配置 clientId
3. **工具命名隔离**: MCP 工具名称格式为 `{serverName}_{toolName}`，避免冲突
4. **状态持久化**: OAuth 令牌存储在本地 JSON 文件，支持刷新令牌自动续期
5. **配置继承**: 支持远程组织默认配置，用户可选择性覆盖启用状态
6. **工具级别控制**: 可通过 `tools` 配置项全局或按 Agent 启用/禁用 MCP 工具
7. **SDK 完全集成**: 基于 `@modelcontextprotocol/sdk` 官方 SDK，仅实现客户端角色
