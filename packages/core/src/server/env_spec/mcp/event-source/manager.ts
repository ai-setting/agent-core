/**
 * @fileoverview EventSource MCP Manager
 * 
 * 负责加载、连接、管理 EventSource MCP Clients
 * 核心职责：
 * 1. 从 mcp.clients 配置中筛选事件源
 * 2. 创建并连接 EventMcpClient
 * 3. EventMcpClient 内部直接调用 env.publishEvent()，无需 Manager 转发
 */

import type { McpClientConfig } from "../../../../env_spec/mcp/types.js";
import type { ServerEnvironment } from "../../../environment.js";
import { EventMcpClient } from "./client.js";
import { EventSourceStatus, type EventSourceOptions } from "./types.js";
import { serverLogger } from "../../../logger.js";

export interface EventSourceClientConfig {
  name: string;
  client: McpClientConfig;
  options?: EventSourceOptions;
  enabled?: boolean;
}

/**
 * EventSource MCP 管理器
 * 负责加载、连接、管理 EventSource MCP Clients
 */
export class EventMcpManager {
  private env: ServerEnvironment;
  private clients: Map<string, EventMcpClient> = new Map();
  private status: Map<string, EventSourceStatus> = new Map();

  constructor(env: ServerEnvironment) {
    this.env = env;
  }

  /**
   * 加载 EventSource MCP Clients
   * 从 mcp.clients 配置中筛选需要作为事件源的客户端
    */
  async loadClients(
    mcpClientsConfig: Record<string, McpClientConfig>,
    eventSourceConfig?: Record<string, EventSourceClientConfig>
  ): Promise<void> {
    // 如果没有单独配置，则默认所有 MCP 客户端都可能是事件源
    const targetConfigs = eventSourceConfig || Object.keys(mcpClientsConfig).reduce((acc, name) => {
      acc[name] = { name, client: mcpClientsConfig[name], enabled: true };
      return acc;
    }, {} as Record<string, EventSourceClientConfig>);

    for (const [name, config] of Object.entries(targetConfigs)) {
      // 从 mcpClientsConfig 获取对应的 client 配置
      const clientConfig = config.client || mcpClientsConfig[name];
      if (!clientConfig) {
        serverLogger.warn(`[EventMcpManager] No client config for ${name}, skipping`);
        continue;
      }

      if (config.enabled === false) {
        serverLogger.info(`[EventMcpManager] Skipping disabled EventSource: ${name}`);
        continue;
      }

      try {
        const client = new EventMcpClient(this.env, name, clientConfig, config.options);
        await client.connect();
        
        this.clients.set(name, client);
        this.status.set(name, EventSourceStatus.RUNNING);
        
        serverLogger.info(`[EventMcpManager] Loaded EventSource: ${name}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        serverLogger.error(`[EventMcpManager] Failed to load ${name}`, { error: errorMsg });
        this.status.set(name, EventSourceStatus.ERROR);
      }
    }
  }

  /**
   * 断开所有 EventSource Clients
   */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.clients.values()).map(client => client.disconnect());
    await Promise.all(promises);
    this.clients.clear();
    this.status.clear();
    serverLogger.info("[EventMcpManager] Disconnected all EventSource clients");
  }

  /**
   * 获取客户端状态
   */
  getStatus(name: string): EventSourceStatus | undefined {
    return this.status.get(name);
  }

  /**
   * 获取所有客户端状态
   */
  getAllStatus(): Map<string, EventSourceStatus> {
    return new Map(this.status);
  }

  /**
   * 获取所有客户端
   */
  getClients(): Map<string, EventMcpClient> {
    return new Map(this.clients);
  }

  /**
   * 获取所有事件源名称
   */
  getEventSourceNames(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * 获取事件源客户端
   */
  getClient(name: string): EventMcpClient | undefined {
    return this.clients.get(name);
  }
}
