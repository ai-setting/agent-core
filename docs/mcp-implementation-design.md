# Agent Core MCP 机制实现方案（加强版）

> 本文档描述 agent-core 中 MCP (Model Context Protocol) 机制的加强版设计与实现方案。
> 核心特点：同时支持 MCP Client（连接外部 MCP 服务器）和 MCP Server（将 Environment 暴露为 MCP 服务器）。
> 整合现有 env_spec 功能，使 BaseEnvironment 原生具备 MCP Server 能力。

---

## 一、设计目标

### 1.1 双重角色

| 角色 | 说明 | 用途 |
|------|------|------|
| **MCP Client** | 连接外部 MCP 服务器，获取其工具 | 使用第三方 MCP 服务（如 Sentry、Context7） |
| **MCP Server** | 将当前 Environment 暴露为 MCP 服务器 | 向外暴露 env/* 工具，供其他 MCP 客户端使用 |

### 1.2 整合现有能力

- **复用 env_spec**：现有的 `EnvMCPServer` 封装、Env 协议工具（env/*）
- **统一配置**：MCP 配置统一放在 Environment 配置中
- **统一资源管理**：MCP 服务器脚本和客户端连接统一在 MCP 模块管理

---

## 二、架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        BaseEnvironment                          │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐ │
│  │   MCP Server    │  │           MCP Client                 │ │
│  │  (EnvMCPServer) │  │          (McpClientManager)          │ │
│  │                 │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐  │ │
│  │ - env/* tools   │  │  │ Server1 │ │ Server2 │ │ Server3│  │ │
│  │ - Stdio/HTTP   │  │  │(remote)│ │(local) │ │(remote)│  │ │
│  └────────┬────────┘  │  └────┬────┘ └────┬────┘ └────┬────┘  │ │
│           │            │        │           │           │        │ │
│           └────────────┴────────┴───────────┴───────────┘        │ │
│                              │                                   │ │
│                    ┌─────────▼─────────┐                        │ │
│                    │   Tool Registry    │◄── 统一工具注册入口    │ │
│                    └───────────────────┘                        │ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 模块结构

```
packages/core/src/
├── core/environment/
│   ├── mcp/                      # MCP 模块（新增/重构）
│   │   ├── index.ts              # MCP 核心：McpServer + McpClientManager
│   │   ├── types.ts              # MCP 类型定义
│   │   ├── auth.ts               # OAuth 凭证管理
│   │   └── loader.ts             # MCP 服务器脚本加载器
│   │
│   ├── base/
│   │   └── base-environment.ts   # 新增 MCP Server/Client 集成
│   │
│   └── skills/                   # Skills 模块（现有）
│
├── env_spec/                     # 整合到 mcp/ 或保持引用
│   ├── server.ts                 # EnvMCPServer（现有）
│   ├── client.ts                 # EnvClient（现有）
│   ├── types.ts                  # EnvDescription, EnvProfile（现有）
│   └── base_env/                 # 从 env 推导 MCP options
│
└── config/
    ├── types.ts                  # 新增 McpConfig Schema
    └── paths.ts                  # 新增 mcpservers 路径
```

---

## 三、MCP Server 能力（Environment 作为 MCP 服务器）

### 3.1 现有能力继承

复用 `env_spec/server.ts` 中的 `EnvMCPServer`：

```typescript
// 现有 env_spec 提供的 Env 协议工具
- env/get_description    # 获取环境描述
- env/list_profiles      # 列出 profiles
- env/get_profile       # 获取单个 profile
- env/list_agents       # 列出 agents
- env/get_agent         # 获取 agent 详情
- env/query_logs        # 查询日志
```

### 3.2 扩展 Env 协议工具

在 Environment 暴露的能力基础上，可扩展更多工具：

```typescript
// 扩展的 MCP Server 工具
- env/execute_tool      # 执行指定工具（高级能力）
- env/list_tools        # 列出所有可用工具
- env/get_prompt        # 获取 prompt
- env/invoke_llm        # 调用 LLM（高级能力）
```

### 3.3 传输层支持

| 传输层 | 用途 | 配置 |
|--------|------|------|
| `StdioServerTransport` | 本地 stdio 方式 | 默认 |
| `WebStandardStreamableHTTPServerTransport` | HTTP 远程方式 | 可配置端口 |

### 3.4 配置

```jsonc
{
  // MCP Server 配置
  "mcpServer": {
    "enabled": true,
    "transport": "stdio",  // 或 "http"
    "http": {
      "port": 3000,
      "host": "0.0.0.0"
    }
  }
}
```

---

## 四、MCP Client 能力（连接外部 MCP 服务器）

### 4.1 功能说明

| 功能 | 说明 |
|------|------|
| 本地 MCP | 通过 stdio 连接本地 MCP 服务器脚本 |
| 远程 MCP | 通过 HTTP/SSE 连接远程 MCP 服务器 |
| OAuth 认证 | 支持 OAuth 自动发现和预注册 |
| 工具转换 | MCP 工具转换为 Environment 统一工具格式 |

### 4.2 目录结构

```
~/.config/tong_work/agent-core/
└── environments/
    └── {env-name}/
        ├── config.jsonc        # 包含 mcp 配置
        ├── mcpservers/        # 本地 MCP 服务器脚本
        │   ├── my-server/
        │   │   ├── server.mjs
        │   │   └── package.json
        │   └── ...
        └── skills/            # Skills 目录（现有）
```

### 4.3 配置示例

```jsonc
{
  "mcp": {
    // ========== 本地 MCP ==========
    "filesystem": {
      "type": "local",
      "command": ["bun", "run", "./mcpservers/filesystem/server.mjs"],
      "enabled": true,
      "timeout": 30000
    },
    
    // ========== 远程 MCP - API Key ==========
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp",
      "enabled": true,
      "headers": {
        "CONTEXT7_API_KEY": "${auth:context7}"
      }
    },
    
    // ========== 远程 MCP - OAuth ==========
    "sentry": {
      "type": "remote",
      "url": "https://mcp.sentry.dev/mcp",
      "oauth": {},
      "enabled": true
    },
    
    // ========== 远程 MCP - OAuth 预注册 ==========
    "github": {
      "type": "remote",
      "url": "https://api.github.com/mcp",
      "oauth": {
        "clientId": "${env:GITHUB_CLIENT_ID}",
        "clientSecret": "${env:GITHUB_CLIENT_SECRET}",
        "scope": "repo read:user"
      },
      "enabled": true
    },
    
    // ========== 禁用 OAuth ==========
    "custom-api": {
      "type": "remote",
      "url": "https://mcp.example.com",
      "oauth": false,
      "headers": {
        "Authorization": "Bearer ${auth:custom-api}"
      }
    }
  }
}
```

### 4.4 MCP 服务器目录扫描与自动发现

MCP Client 支持两种配置方式：

#### 方式一：配置驱动（显式配置）

通过 `config.jsonc` 中的 `mcp` 字段显式配置每个 MCP 服务器：

```jsonc
{
  "mcp": {
    "my-server": {
      "type": "local",
      "command": ["bun", "run", "./mcpservers/my-server/server.mjs"]
    }
  }
}
```

#### 方式二：目录扫描（自动发现）

系统会自动扫描 `mcpservers/` 目录，发现并加载符合条件的 MCP 服务器脚本：

```
mcpservers/
├── filesystem/
│   ├── server.mjs          # MCP 服务器入口脚本
│   ├── package.json       # 依赖声明（可选）
│   └── config.jsonc       # MCP 服务器配置（可选）
│
├── todo/
│   ├── server.mjs
│   └── package.json
│
└── ...
```

**扫描逻辑**：

```typescript
// packages/core/src/env_spec/mcp/loader.ts

import fs from "fs/promises"
import path from "path"

export interface DiscoveredMcpServer {
  name: string           // 目录名作为服务器名称
  entryPath: string     // server.mjs 的绝对路径
  configPath?: string   // 可选的 config.jsonc 路径
  packagePath?: string  // 可选的 package.json 路径
}

export class McpServerLoader {
  private mcpserversDir: string
  
  constructor(mcpserversDir: string) {
    this.mcpserversDir = mcpserversDir
  }
  
  /**
   * 扫描 mcpservers 目录，发现所有 MCP 服务器
   * 规则：
   * 1. 每个子目录视为一个 MCP 服务器
   * 2. 目录中必须包含 server.mjs 入口脚本
   * 3. 可选包含 package.json 声明依赖
   * 4. 可选包含 config.jsonc 覆盖默认配置
   */
  async discover(): Promise<DiscoveredMcpServer[]> {
    const servers: DiscoveredMcpServer[] = []
    
    try {
      const entries = await fs.readdir(this.mcpserversDir, { withFileTypes: true })
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        
        const serverDir = path.join(this.mcpserversDir, entry.name)
        const entryPath = path.join(serverDir, "server.mjs")
        
        // 检查是否存在 server.mjs
        try {
          await fs.access(entryPath)
        } catch {
          // 没有 server.mjs，跳过
          continue
        }
        
        const configPath = path.join(serverDir, "config.jsonc")
        const packagePath = path.join(serverDir, "package.json")
        
        servers.push({
          name: entry.name,
          entryPath,
          configPath: await this.fileExists(configPath) ? configPath : undefined,
          packagePath: await this.fileExists(packagePath) ? packagePath : undefined,
        })
      }
    } catch (error) {
      console.warn(`[McpServerLoader] Failed to scan directory: ${error}`)
    }
    
    return servers
  }
  
  private async fileExists(filepath: string): Promise<boolean> {
    try {
      await fs.access(filepath)
      return true
    } catch {
      return false
    }
  }
}
```

**加载流程**：

```typescript
// 完整的 MCP Client 初始化流程

export async function loadMcpClients(
  mcpserversDir: string,
  config: Record<string, McpClientConfig>
): Promise<{ loaded: number; failed: string[] }> {
  const failed: string[] = []
  let loaded = 0
  
  // 1. 扫描 mcpservers 目录，发现服务器脚本
  const loader = new McpServerLoader(mcpserversDir)
  const discovered = await loader.discover()
  
  // 2. 为每个发现的服务器构建配置
  for (const server of discovered) {
    const name = server.name
    
    // 优先使用显式配置，其次使用目录扫描发现的默认配置
    const explicitConfig = config[name]
    const serverConfig = explicitConfig ?? buildDefaultConfig(server)
    
    // 检查是否启用
    if (serverConfig.enabled === false) {
      console.log(`[MCP] Skipping disabled server: ${name}`)
      continue
    }
    
    // 3. 连接 MCP 服务器
    try {
      await mcpManager.connectClient(name, serverConfig)
      console.log(`[MCP] Loaded: ${name}`)
      loaded++
    } catch (error) {
      console.error(`[MCP] Failed to load ${name}:`, error)
      failed.push(name)
    }
  }
  
  // 4. 处理仅在配置中定义但目录中不存在的服务器
  for (const [name, serverConfig] of Object.entries(config)) {
    if (!discovered.find(s => s.name === name)) {
      // 配置中定义的远程 MCP 或显式配置的本地 MCP
      if (serverConfig.type === "remote" || serverConfig.command) {
        try {
          await mcpManager.connectClient(name, serverConfig)
          loaded++
        } catch (error) {
          failed.push(name)
        }
      }
    }
  }
  
  return { loaded, failed }
}

function buildDefaultConfig(server: DiscoveredMcpServer): McpClientConfig {
  // 从目录中的 config.jsonc 读取配置
  // 或者使用默认配置
  return {
    type: "local",
    command: ["bun", "run", server.entryPath],
    enabled: true,
  }
}
```

**服务器目录配置覆盖**：

如果 `mcpservers/{name}/config.jsonc` 存在，其配置会覆盖默认行为：

```jsonc
// mcpservers/filesystem/config.jsonc
{
  "enabled": true,
  "timeout": 60000,
  "environment": {
    "ALLOW_WRITE": "true"
  }
}
```

### 4.5 配置优先级

MCP 服务器配置的优先级（从高到低）：

1. **显式配置**：`config.jsonc` 中的 `mcp.{name}` 字段
2. **目录配置**：`mcpservers/{name}/config.jsonc`
3. **默认配置**：自动扫描发现的默认行为

### 4.6 MCP 工具到 Environment Tool 的转换与注册

MCP 服务器连接成功后，需要将其工具转换为 Environment 统一的 `ToolInfo` 格式并注册。

#### 4.6.1 ToolInfo 类型定义

```typescript
// packages/core/src/core/types/index.ts

export interface ToolInfo {
  name: string
  description: string
  parameters: z.ZodType<unknown>
  execute: (args: unknown, context: ToolContext) => Promise<ToolResult>
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
}

export interface ToolContext {
  sessionId?: string
  agentId?: string
  // ... 其他上下文
}
```

#### 4.6.2 MCP 工具转换核心逻辑

```typescript
// packages/core/src/env_spec/mcp/convert.ts

import type { Tool as McpTool, CallToolResult as McpCallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { ToolInfo, ToolResult, ToolContext } from "../../core/types/index.js"
import { z } from "zod"

/**
 * 将 MCP 工具转换为 Environment 的 ToolInfo 格式
 * 
 * 转换要点：
 * 1. 工具命名：{mcpName}_{toolName}，避免与其他工具冲突
 * 2. 参数 schema：从 MCP inputSchema 转换为 Zod
 * 3. 执行逻辑：调用 MCP client 的 callTool
 */
export function convertMcpTool(
  mcpTool: McpTool,
  mcpClient: Client,
  mcpName: string,
  options?: {
    timeout?: number
    onError?: (error: Error) => void
  }
): ToolInfo {
  const toolName = `${mcpName}_${mcpTool.name}`
  
  // 将 MCP inputSchema 转换为 Zod schema
  const zodParams = convertInputSchemaToZod(mcpTool.inputSchema)
  
  return {
    name: toolName,
    description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
    parameters: zodParams,
    execute: async (args: unknown, context: ToolContext): Promise<ToolResult> => {
      try {
        // 调用 MCP 工具
        const result = await mcpClient.callTool(
          {
            name: mcpTool.name,
            arguments: args as Record<string, unknown>,
          },
          // 可选：设置超时
          { timeout: options?.timeout }
        )
        
        // 转换结果格式
        return convertMcpCallResult(result)
      } catch (error) {
        options?.onError?.(error as Error)
        return {
          success: false,
          output: "",
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

/**
 * 将 MCP inputSchema 转换为 Zod schema
 */
function convertInputSchemaToZod(inputSchema: McpTool["inputSchema"]): z.ZodType<unknown> {
  if (!inputSchema) {
    return z.unknown()
  }
  
  // 处理 JSON Schema 格式
  const schema = inputSchema as JSONSchema7
  
  const properties = schema.properties ?? {}
  const required = schema.required ?? []
  
  const zodFields: Record<string, z.ZodType> = {}
  
  for (const [key, prop] of Object.entries(properties)) {
    zodFields[key] = jsonSchemaPropToZod(prop as JSONSchema7)
  }
  
  return z.object(zodFields).strict()
}

/**
 * 将 JSON Schema 属性转换为 Zod 类型
 */
function jsonSchemaPropToZod(prop: JSONSchema7): z.ZodType {
  const type = prop.type as string
  
  switch (type) {
    case "string":
      return z.string()
    case "number":
    case "integer":
      return z.number()
    case "boolean":
      return z.boolean()
    case "array":
      return z.array(jsonSchemaPropToZod(prop.items as JSONSchema7))
    case "object":
      return z.record(z.string(), jsonSchemaPropToZod(prop.additionalProperties as JSONSchema7))
    default:
      return z.unknown()
  }
}

/**
 * 转换 MCP 调用结果为 ToolResult
 */
function convertMcpCallResult(result: McpCallToolResult): ToolResult {
  // MCP 结果格式: { content: Array<{ type: "text", text: string }> }
  const content = result.content
  const textContent = content
    .filter(c => c.type === "text")
    .map(c => c.text)
    .join("")
  
  return {
    success: !result.isError,
    output: textContent,
    error: result.isError ? textContent : undefined,
  }
}
```

#### 4.6.3 工具注册到 Environment

```typescript
// packages/core/src/env_spec/mcp/manager.ts

export class McpManager {
  private clients: Map<string, Client> = new Map()
  private tools: Map<string, ToolInfo> = new Map()
  
  /**
   * 连接 MCP 客户端并注册工具
   */
  async connectClient(name: string, config: McpClientConfig): Promise<void> {
    // 1. 创建传输层并连接
    const transport = this.createTransport(config)
    const client = new Client({ name: "agent-core", version: "1.0.0" })
    await client.connect(transport)
    this.clients.set(name, client)
    
    // 2. 获取工具列表
    const toolsResult = await client.listTools()
    
    // 3. 转换并注册每个工具
    for (const mcpTool of toolsResult.tools) {
      const toolInfo = convertMcpTool(mcpTool, client, name, {
        timeout: config.timeout,
      })
      this.tools.set(toolInfo.name, toolInfo)
    }
    
    console.log(`[MCP] Loaded ${toolsResult.tools.length} tools from ${name}`)
  }
  
  /**
   * 断开客户端并注销工具
   */
  async disconnectClient(name: string): Promise<void> {
    const client = this.clients.get(name)
    if (client) {
      await client.close()
      this.clients.delete(name)
    }
    
    // 注销该 MCP 的所有工具
    const toolPrefix = `${name}_`
    for (const [toolName] of this.tools) {
      if (toolName.startsWith(toolPrefix)) {
        this.tools.delete(toolName)
      }
    }
  }
  
  /**
   * 获取所有已注册的 MCP 工具
   */
  getTools(): ToolInfo[] {
    return Array.from(this.tools.values())
  }
  
  /**
   * 获取工具描述（用于 system prompt）
   */
  getToolsDescription(): string {
    const tools = this.getTools()
    return tools
      .map(t => `  - ${t.name}: ${t.description}`)
      .join("\n")
  }
}
```

#### 4.6.4 与 BaseEnvironment 集成

```typescript
// packages/core/src/core/environment/base/base-environment.ts

export abstract class BaseEnvironment {
  protected mcpManager: McpManager | null = null
  
  /**
   * 初始化 MCP 模块
   */
  protected async initializeMcp(): Promise<void> {
    const clientConfig = this.getMcpClientConfig()
    const mcpserversDir = this.getMcpserversDirectory()
    
    if (!clientConfig && !mcpserversDir) {
      return
    }
    
    this.mcpManager = new McpManager()
    
    // 1. 如果有 mcpservers 目录，扫描并加载
    if (mcpserversDir) {
      const loader = new McpServerLoader(mcpserversDir)
      const discovered = await loader.discover()
      
      for (const server of discovered) {
        const explicitConfig = clientConfig?.[server.name]
        const config = explicitConfig ?? buildDefaultConfig(server)
        
        if (config.enabled !== false) {
          try {
            await this.mcpManager.connectClient(server.name, config)
          } catch (error) {
            console.error(`[MCP] Failed to load ${server.name}:`, error)
          }
        }
      }
    }
    
    // 2. 处理配置中定义但目录中没有的服务器
    if (clientConfig) {
      for (const [name, config] of Object.entries(clientConfig)) {
        if (!this.mcpManager.hasClient(name)) {
          try {
            await this.mcpManager.connectClient(name, config)
          } catch (error) {
            console.error(`[MCP] Failed to load ${name}:`, error)
          }
        }
      }
    }
  }
  
  /**
   * 注册 MCP 工具到 Environment
   * 在 getTools() 中调用
   */
  protected registerMcpTools(): void {
    if (!this.mcpManager) return
    
    const mcpTools = this.mcpManager.getTools()
    for (const tool of mcpTools) {
      this.registerTool(tool)
    }
  }
  
  /**
   * 获取所有工具（包括 MCP 工具）
   */
  public getTools(): ToolInfo[] {
    const tools: ToolInfo[] = []
    
    // 原有工具
    for (const [name, tool] of this.toolRegistry) {
      tools.push(tool)
    }
    
    // MCP 工具
    if (this.mcpManager) {
      tools.push(...this.mcpManager.getTools())
    }
    
    return tools
  }
}
```

#### 4.6.5 工具命名空间隔离

为避免工具名称冲突，MCP 工具使用命名空间前缀：

```
MCP 服务器 "filesystem" 的工具:
  → filesystem_read
  → filesystem_write
  → filesystem_list

MCP 服务器 "todo" 的工具:
  → todo_add
  → todo_list
  → todo_complete
```

这样可以：
1. 避免不同 MCP 服务器的工具名称冲突
2. 通过工具名称前缀快速识别工具来源
3. 支持按前缀批量启用/禁用

---

## 五、BaseEnvironment 集成设计

### 5.1 接口设计

```typescript
// packages/core/src/core/environment/base/base-environment.ts

export abstract class BaseEnvironment {
  // ========== MCP Server 相关 ==========
  
  /** 是否启用 MCP Server */
  protected abstract isMcpServerEnabled(): boolean
  
  /** 获取 MCP Server 配置 */
  protected abstract getMcpServerConfig(): McpServerConfig | undefined
  
  /** 启动 MCP Server */
  public async startMcpServer(): Promise<void>
  
  /** 停止 MCP Server */
  public async stopMcpServer(): Promise<void>
  
  // ========== MCP Client 相关 ==========
  
  /** 获取 MCP 服务器脚本目录 */
  protected abstract getMcpserversDirectory(): string | undefined
  
  /** 获取 MCP 客户端配置 */
  protected abstract getMcpClientConfig(): Record<string, McpClientConfig> | undefined
  
  /** 加载并连接 MCP 客户端 */
  public async loadMcpClients(): Promise<McpClientLoadResult>
  
  /** 断开指定 MCP 客户端 */
  public async disconnectMcpClient(name: string): Promise<void>
  
  /** 重新连接指定 MCP 客户端 */
  public async reconnectMcpClient(name: string): Promise<void>
  
  // ========== 工具注册 ==========
  
  /** 获取所有 MCP 工具 */
  public getMcpTools(): ToolInfo[]
}
```

### 5.2 MCP 配置 Schema

```typescript
// packages/core/src/config/types.ts

// MCP Server 配置
const McpServerConfig = z.object({
  enabled: z.boolean().optional(),
  transport: z.enum(["stdio", "http"]).optional(),
  http: z.object({
    port: z.number().int().positive().optional(),
    host: z.string().optional(),
  }).optional(),
})

// MCP OAuth 配置
const McpOAuth = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  scope: z.string().optional(),
})

// MCP 本地客户端配置
const McpClientLocal = z.object({
  type: z.literal("local"),
  command: z.array(z.string()),
  environment: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  timeout: z.number().int().positive().optional(),
})

// MCP 远程客户端配置
const McpClientRemote = z.object({
  type: z.literal("remote"),
  url: z.string(),
  enabled: z.boolean().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  oauth: z.union([McpOAuth, z.literal(false)]).optional(),
  timeout: z.number().int().positive().optional(),
})

// MCP 客户端配置联合类型
const McpClientConfig = z.discriminatedUnion("type", [McpClientLocal, McpClientRemote])

// MCP 字段（支持仅启用/禁用远程默认）
const McpField = z.record(
  z.string(),
  z.union([
    McpClientConfig,
    z.object({ enabled: z.boolean() })
  ])
)

// 主配置中的 MCP 相关字段
const McpConfig = z.object({
  server: McpServerConfig.optional(),
  clients: McpField.optional(),
})
```

---

## 六、核心实现

### 6.1 McpManager 核心类

```typescript
// packages/core/src/core/environment/mcp/index.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"

export interface McpClientConfig {
  type: "local" | "remote"
  command?: string[]
  url?: string
  enabled?: boolean
  environment?: Record<string, string>
  headers?: Record<string, string>
  oauth?: McpOAuthConfig | false
  timeout?: number
}

export interface McpServerConfig {
  enabled?: boolean
  transport?: "stdio" | "http"
  http?: {
    port?: number
    host?: string
  }
}

/**
 * MCP 管理器
 * 同时负责 MCP Server 和 MCP Client 的生命周期管理
 */
export class McpManager {
  private server: McpServer | null = null
  private serverTransport: StdioServerTransport | WebStandardStreamableHTTPServerTransport | null = null
  private clients: Map<string, Client> = new Map()
  private tools: Map<string, ToolInfo> = new Map()
  
  // ========== MCP Server 方法 ==========
  
  /**
   * 启动 MCP Server
   * 将当前 Environment 的能力暴露为 MCP Server
   */
  async startServer(
    config: McpServerConfig,
    envOptions: EnvServerOptions
  ): Promise<void> {
    // 创建 EnvMCPServer
    this.server = new EnvMCPServer(envOptions)
    
    // 选择传输层
    if (config.transport === "http") {
      this.serverTransport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      })
    } else {
      this.serverTransport = new StdioServerTransport()
    }
    
    await this.server.connect(this.serverTransport)
    
    // 如果是 HTTP，启动监听
    if (config.transport === "http" && this.serverTransport instanceof WebStandardStreamableHTTPServerTransport) {
      const port = config.http?.port ?? 3000
      const host = config.http?.host ?? "0.0.0.0"
      // 启动 Bun.serve 或类似服务
    }
  }
  
  /**
   * 停止 MCP Server
   */
  async stopServer(): Promise<void> {
    if (this.server) {
      await this.server.close()
      this.server = null
      this.serverTransport = null
    }
  }
  
  // ========== MCP Client 方法 ==========
  
  /**
   * 连接 MCP 客户端
   */
  async connectClient(name: string, config: McpClientConfig): Promise<void> {
    let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport
    
    if (config.type === "local") {
      const [cmd, ...args] = config.command!
      transport = new StdioClientTransport({
        command: cmd,
        args,
        env: { ...process.env, ...config.environment },
      })
    } else {
      // 远程 MCP
      const authProvider = config.oauth ? createOAuthProvider(name, config.url!, config.oauth) : undefined
      
      // 尝试 StreamableHTTP
      transport = new StreamableHTTPClientTransport(new URL(config.url!), {
        authProvider,
        requestInit: config.headers ? { headers: config.headers } : undefined,
      })
    }
    
    const client = new Client({ name: "agent-core", version: "1.0.0" })
    await client.connect(transport)
    
    this.clients.set(name, client)
    
    // 获取工具并转换
    const toolsResult = await client.listTools()
    for (const tool of toolsResult.tools) {
      const toolName = `${name}_${tool.name}`
      this.tools.set(toolName, convertMcpTool(tool, client, config.timeout))
    }
  }
  
  /**
   * 断开 MCP 客户端
   */
  async disconnectClient(name: string): Promise<void> {
    const client = this.clients.get(name)
    if (client) {
      await client.close()
      this.clients.delete(name)
    }
    
    // 清理工具
    for (const [toolName] of this.tools) {
      if (toolName.startsWith(`${name}_`)) {
        this.tools.delete(toolName)
      }
    }
  }
  
  /**
   * 获取所有 MCP 工具
   */
  getTools(): ToolInfo[] {
    return Array.from(this.tools.values())
  }
}
```

### 6.2 与 Environment 集成

```typescript
// packages/core/src/core/environment/base/base-environment.ts

export abstract class BaseEnvironment {
  protected mcpManager: McpManager | null = null
  
  /**
   * 初始化 MCP 模块
   */
  protected async initializeMcp(): Promise<void> {
    // 1. 初始化 MCP Server
    if (this.isMcpServerEnabled()) {
      const serverConfig = this.getMcpServerConfig()
      if (serverConfig?.enabled) {
        this.mcpManager = new McpManager()
        const envOptions = this.createMcpServerOptions()
        await this.mcpManager.startServer(serverConfig, envOptions)
      }
    }
    
    // 2. 初始化 MCP Clients
    const clientConfig = this.getMcpClientConfig()
    if (clientConfig) {
      if (!this.mcpManager) {
        this.mcpManager = new McpManager()
      }
      
      for (const [name, config] of Object.entries(clientConfig)) {
        if (config.enabled !== false) {
          try {
            await this.mcpManager.connectClient(name, config)
          } catch (error) {
            console.error(`[MCP] Failed to connect ${name}:`, error)
          }
        }
      }
    }
  }
  
  /**
   * 创建 MCP Server 选项（整合 env_spec）
   */
  protected createMcpServerOptions(): EnvServerOptions {
    return {
      describeEnv: async () => ({
        id: this.getEnvId(),
        displayName: this.getEnvDisplayName(),
        version: "1.0.0",
        capabilities: {
          logs: true,
          events: true,
          profiles: true,
          mcpTools: true,
          mcpServer: true,  // 标识支持 MCP Server
        },
        profiles: this.getProfiles(),
      }),
      listProfiles: () => this.getProfiles(),
      listAgents: () => this.getAgents(),
      queryLogs: async (params) => this.queryLogs(params),
    }
  }
}
```

---

## 七、配置加载流程

```
1. 加载配置
   ├── Global 配置 (tong_work.jsonc)
   └── Environment 配置 (environments/{env}/config.jsonc)
       ├── mcp.server     # MCP Server 配置
       └── mcp.clients   # MCP Clients 配置

2. 初始化 Environment
   ├── 初始化 MCP Server（如果 enabled）
   │   └── 创建 EnvMCPServer，注册 env/* 工具
   │   └── 启动 Stdio 或 HTTP 传输
   │
   └── 初始化 MCP Clients
       ├── 扫描 mcpservers 目录（可选）
       └── 连接各个 MCP 服务器
           └── 获取工具并注册

3. 注册工具到 Environment
   ├── 原有工具（bash, file, etc.）
   ├── Skills 工具
   └── MCP 工具（统一格式）
```

---

## 八、目录重组

### 8.1 方案一：整合到 env_spec

将 MCP Client 功能整合到现有的 `env_spec` 目录：

```
packages/core/src/env_spec/
├── index.ts                 # 统一导出
├── types.ts                 # EnvDescription, McpConfig 等类型
├── server.ts                # EnvMCPServer（现有）
├── client.ts                # EnvClient（现有）
├── mcp/
│   ├── index.ts             # McpManager（MCP Client + Server 统一管理）
│   ├── auth.ts             # OAuth 认证
│   └── loader.ts            # MCP 服务器脚本加载
├── base_env/                # 从 env 推导
│   └── index.ts
└── json_spec/
    └── env-protocol.json
```

### 8.2 方案二：保持分离

```
packages/core/src/
├── env_spec/                # Env 协议相关（现有）
│   ├── server.ts
│   ├── client.ts
│   └── types.ts
│
└── core/environment/
    └── mcp/                 # MCP 核心（新增/重构）
        ├── index.ts         # McpManager
        ├── client.ts        # MCP Client 专用
        ├── server.ts        # MCP Server 专用
        └── auth.ts
```

**推荐方案一**，更符合"加强版 MCP"的定位。

---

## 九、实施计划
按照方案一的目录组织哈。
### Phase 1: 基础架构
- [ ] 重构/新建 `env_spec/mcp/` 模块
- [ ] 实现 `McpManager` 核心类
- [ ] 整合 `EnvMCPServer` 到统一管理

### Phase 2: MCP Server 集成
- [ ] 在 `BaseEnvironment` 中集成 MCP Server 能力
- [ ] 实现 `startMcpServer()` / `stopMcpServer()`
- [ ] 配置 Schema 添加 `mcp.server` 字段

### Phase 3: MCP Client 集成
- [ ] 实现 MCP Client 连接逻辑
- [ ] 实现工具转换和注册
- [ ] 配置 Schema 添加 `mcp.clients` 字段
- [ ] OAuth 认证支持

### Phase 4: 测试与示例
- [ ] 编写集成测试
- [ ] 创建示例 MCP 服务器
- [ ] 文档完善

---

## 十、关键代码路径

| 功能 | 文件 |
|------|------|
| MCP 核心 | `env_spec/mcp/index.ts` |
| MCP Server | `env_spec/server.ts`（现有），整合到 mcp 模块 |
| MCP Client | `env_spec/mcp/client.ts` |
| OAuth 认证 | `env_spec/mcp/auth.ts` |
| 类型定义 | `env_spec/types.ts`（扩展） |
| 配置 Schema | `config/types.ts` |
| BaseEnvironment | `core/environment/base/base-environment.ts` |
| ServerEnvironment | `server/environment.ts` |

---

## 十一、与现有能力的关系

| 现有能力 | 整合方式 |
|---------|---------|
| **env_spec/EnvMCPServer** | 整合到统一 McpManager，作为 MCP Server 核心 |
| **env_spec/types** | 扩展 EnvDescription，添加 mcpServer 字段 |
| **Skills** | 保持独立，MCP 工具和 Skill 工具统一注册到 Environment |
| **配置系统** | MCP 配置作为 Environment 配置的一部分 |

---

## 十二、决策记录

- 2026-02-14：创建加强版 MCP 实现方案，整合 MCP Client 和 MCP Server 能力
- 2026-02-14：确定将 MCP 功能整合到 env_spec 目录，保持与 Env 协议的紧密关联
- 2026-02-14：BaseEnvironment 原生支持 MCP Server 和 MCP Client 双重角色
