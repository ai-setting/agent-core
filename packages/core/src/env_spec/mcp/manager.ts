/**
 * @fileoverview MCP 管理器
 * 
 * 统一管理 MCP Server 和 MCP Client 的生命周期
 */

import path from "path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js"
import type { ToolInfo } from "../../core/types/index.js"
import type {
  McpClientConfig,
  McpServerConfig,
  McpClientStatus,
  McpServerStatus,
  McpToolConversionOptions,
} from "./types.js"
import { convertMcpTool, createMcpToolsDescription } from "./convert.js"
import { McpServerLoader, type DiscoveredMcpServer, type McpServerDirectoryConfig } from "./loader.js"
import { serverLogger } from "../../server/logger.js"

export interface McpClientLoadResult {
  loaded: number
  failed: { name: string; error: string }[]
}

/**
 * MCP 管理器
 * 同时负责 MCP Server 和 MCP Client 的生命周期管理
 */
export class McpManager {
  private clients: Map<string, Client> = new Map()
  private transports: Map<string, StdioClientTransport | StreamableHTTPClientTransport> = new Map()
  private tools: Map<string, ToolInfo> = new Map()
  private status: Map<string, McpClientStatus> = new Map()
  private mcpserversDir?: string

  constructor(mcpserversDir?: string) {
    this.mcpserversDir = mcpserversDir
  }

  // ========== MCP Client 方法 ==========

  /**
   * 加载并连接 MCP 客户端
   * 支持从目录扫描和显式配置两种方式
   */
  async loadClients(
    explicitConfig?: Record<string, McpClientConfig>
  ): Promise<McpClientLoadResult> {
    const failed: { name: string; error: string }[] = []
    let loaded = 0

    // 1. 如果有 mcpservers 目录，扫描并加载
    if (this.mcpserversDir) {
      const loader = new McpServerLoader(this.mcpserversDir)
      const discovered = await loader.discover()
      console.log(`[MCP] Discovered ${discovered.length} MCP servers from ${this.mcpserversDir}`)

      for (const server of discovered) {
        // 服务器目录名与 server.name 相同
        const serverDir = path.join(this.mcpserversDir, server.name)
        const directoryConfig = await loader.loadServerConfig(serverDir)
        
        serverLogger.info(`[MCP] Loaded directory config for ${server.name}`, { 
          directoryConfig,
          serverDir 
        })
        
        const defaultConfig = this.buildDefaultConfig(server, directoryConfig)
        const explicitServerConfig = explicitConfig?.[server.name]
        const config = this.mergeConfig(defaultConfig, explicitServerConfig)

        serverLogger.info(`[MCP] Final config for ${server.name}`, { 
          environment: config.type === "local" ? config.environment : undefined,
          command: config.type === "local" ? config.command : undefined
        })

        // 检查是否启用
        if (config.enabled === false) {
          console.log(`[MCP] Skipping disabled server: ${server.name}`)
          this.status.set(server.name, { name: server.name, status: "disconnected" })
          continue
        }

        // 连接 MCP 服务器
        try {
          await this.connectClient(server.name, config)
          loaded++
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          console.error(`[MCP] Failed to load ${server.name}:`, errorMsg)
          failed.push({ name: server.name, error: errorMsg })
          this.status.set(server.name, { name: server.name, status: "error", error: errorMsg })
        }
      }
    }

    // 2. 处理配置中定义但目录中没有的服务器
    if (explicitConfig) {
      for (const [name, config] of Object.entries(explicitConfig)) {
        if (!this.clients.has(name)) {
          try {
            await this.connectClient(name, config)
            loaded++
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            failed.push({ name, error: errorMsg })
            this.status.set(name, { name, status: "error", error: errorMsg })
          }
        }
      }
    }

    return { loaded, failed }
  }

  /**
   * 构建默认配置
   */
  private buildDefaultConfig(server: DiscoveredMcpServer, directoryConfig?: McpServerDirectoryConfig | null): McpClientConfig {
    const command = directoryConfig?.command ?? ["bun", "run", server.entryPath]
    return {
      type: "local",
      command,
      enabled: directoryConfig?.enabled ?? true,
      timeout: directoryConfig?.timeout,
      environment: directoryConfig?.environment,
    }
  }

  /**
   * 合并配置（显式配置覆盖默认配置）
   */
  private mergeConfig(defaultConfig: McpClientConfig, explicitConfig?: McpClientConfig): McpClientConfig {
    if (!explicitConfig) {
      return defaultConfig
    }
    
    // 如果显式配置是 enabled: false，直接返回
    if (explicitConfig.enabled === false) {
      return { ...defaultConfig, enabled: false }
    }
    
    // 合并 local 类型配置
    if (defaultConfig.type === "local" && (!explicitConfig.type || explicitConfig.type === "local")) {
      return {
        type: "local",
        command: explicitConfig.command ?? defaultConfig.command,
        enabled: explicitConfig.enabled ?? defaultConfig.enabled,
        timeout: explicitConfig.timeout ?? defaultConfig.timeout,
        environment: {
          ...defaultConfig.environment,
          ...explicitConfig.environment,
        },
      }
    }
    
    // 其他情况，显式配置优先
    return explicitConfig
  }

  /**
   * 连接 MCP 客户端
   */
  async connectClient(name: string, config: McpClientConfig): Promise<void> {
    // 如果已连接，先断开
    if (this.clients.has(name)) {
      await this.disconnectClient(name)
    }

    this.status.set(name, { name, status: "connecting" })
    serverLogger.info(`[MCP] Connecting to ${name}`, { config })

    try {
      // 创建传输层并连接
      const transport = this.createTransport(config)
      serverLogger.debug(`[MCP] Transport created for ${name}`)
      
      const client = new Client({ name: "agent-core", version: "1.0.0" })
      serverLogger.debug(`[MCP] Connecting client for ${name}...`)
      await client.connect(transport)
      serverLogger.debug(`[MCP] Client connected for ${name}`)

      this.clients.set(name, client)
      this.transports.set(name, transport)

      // 获取工具列表并转换
      serverLogger.debug(`[MCP] Listing tools for ${name}...`)
      const toolsResult = await client.listTools()

      const mcpTools = toolsResult.tools as McpTool[]
      serverLogger.debug(`[MCP] Found ${mcpTools?.length ?? 0} tools for ${name}`)
      
      const options: McpToolConversionOptions = {
        timeout: config.timeout,
        transport: transport as StdioClientTransport,
      }

      for (const mcpTool of mcpTools || []) {
        serverLogger.debug(`[MCP] Converting tool: ${mcpTool.name}`)
        const toolInfo = convertMcpTool(mcpTool, client, name, options)
        this.tools.set(toolInfo.name, toolInfo)
      }

      this.status.set(name, {
        name,
        status: "connected",
        toolsCount: mcpTools?.length ?? 0,
      })

      console.log(`[MCP] Loaded ${mcpTools?.length ?? 0} tools from ${name}`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      serverLogger.error(`[MCP] Failed to connect to ${name}:`, { error: errorMsg, stack: error instanceof Error ? error.stack : undefined })
      this.status.set(name, { name, status: "error", error: errorMsg })
      throw error
    }
  }

  /**
   * 创建传输层
   */
  private createTransport(config: McpClientConfig): StdioClientTransport | StreamableHTTPClientTransport {
    if (config.type === "local") {
      const [cmd, ...args] = config.command!
      const env: Record<string, string> = {}
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          env[key] = value
        }
      }
      if (config.environment) {
        Object.assign(env, config.environment)
      }
      return new StdioClientTransport({
        command: cmd,
        args,
        env,
        stderr: "pipe",
      })
    } else {
      // 远程 MCP
      return new StreamableHTTPClientTransport(new URL(config.url!), {
        requestInit: config.headers ? { headers: config.headers } : undefined,
      })
    }
  }

  /**
   * 断开 MCP 客户端
   */
  async disconnectClient(name: string): Promise<void> {
    const client = this.clients.get(name)
    if (client) {
      try {
        await client.close()
      } catch (error) {
        console.warn(`[MCP] Error closing client ${name}:`, error)
      }
      this.clients.delete(name)
    }

    // 清理该 MCP 的所有工具
    const toolPrefix = `${name}_`
    for (const [toolName] of this.tools) {
      if (toolName.startsWith(toolPrefix)) {
        this.tools.delete(toolName)
      }
    }

    this.status.set(name, { name, status: "disconnected" })
  }

  /**
   * 重新连接 MCP 客户端
   */
  async reconnectClient(name: string, config: McpClientConfig): Promise<void> {
    await this.disconnectClient(name)
    await this.connectClient(name, config)
  }

  /**
   * 检查客户端是否已连接
   */
  hasClient(name: string): boolean {
    return this.clients.has(name)
  }

  // ========== 工具获取方法 ==========

  /**
   * 获取所有已注册的 MCP 工具
   */
  getTools(): ToolInfo[] {
    return Array.from(this.tools.values())
  }

  /**
   * 获取所有已连接的 MCP 服务器名称
   */
  getServerNames(): string[] {
    return Array.from(this.clients.keys())
  }

  /**
   * 获取工具描述（用于 system prompt）
   */
  getToolsDescription(): string {
    return createMcpToolsDescription(this.getTools())
  }

  // ========== 状态查询方法 ==========

  /**
   * 获取客户端状态
   */
  getClientStatus(name: string): McpClientStatus | undefined {
    return this.status.get(name)
  }

  /**
   * 获取所有客户端状态
   */
  getAllStatus(): Map<string, McpClientStatus> {
    return this.status
  }

  /**
   * 获取工具数量
   */
  getToolsCount(): number {
    return this.tools.size
  }

  // ========== 清理方法 ==========

  /**
   * 断开所有客户端
   */
  async disconnectAll(): Promise<void> {
    const names = Array.from(this.clients.keys())
    await Promise.all(names.map(name => this.disconnectClient(name)))
  }
}
