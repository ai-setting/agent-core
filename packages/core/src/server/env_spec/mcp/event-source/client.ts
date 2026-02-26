/**
 * @fileoverview EventSource MCP Client
 * 
 * 封装与 EventSource MCP Server 的连接和事件处理
 * 核心职责：
 * 1. 连接到 MCP Server
 * 2. 接收 Server 推送的事件
 *    - Remote (HTTP): 使用 MCP Notification 实时推送
 *    - Local (Stdio): 使用轮询 fallback
 * 3. 直接调用 env.publishEvent() 发布到 EnvEventBus
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ServerEnvironment } from "../../../environment.js";
import type { EnvEvent } from "../../../../core/types/event.js";
import type { McpClientConfig } from "../../../../env_spec/mcp/types.js";
import type { Notification } from "@modelcontextprotocol/sdk/types.js";
import { EventSourceStatus, type EventSourceOptions } from "./types.js";
import { serverLogger } from "../../../logger.js";

export class EventMcpClient {
  private env: ServerEnvironment;
  private name: string;
  private config: McpClientConfig;
  private options?: EventSourceOptions;
  private client?: Client;
  private transport?: StdioClientTransport | StreamableHTTPClientTransport;
  private status: EventSourceStatus = EventSourceStatus.STOPPED;
  private pollInterval?: ReturnType<typeof setInterval>;
  private eventCount = 0;

  constructor(
    env: ServerEnvironment,
    name: string,
    config: McpClientConfig,
    options?: EventSourceOptions
  ) {
    this.env = env;
    this.name = name;
    this.config = config;
    this.options = options;
  }

  /**
   * 连接到 EventSource MCP Server
   */
  async connect(): Promise<void> {
    this.status = EventSourceStatus.STARTING;
    this.transport = this.createTransport();
    this.client = new Client({ name: `eventsource-${this.name}`, version: "1.0.0" });

    await this.client.connect(this.transport);

    // Remote 使用 Notification，Local 使用轮询
    if (this.config.type === "remote") {
      this.setupNotificationHandler();
      serverLogger.info(`[EventMcpClient] Connected to ${this.name} (mode: notification)`);
    } else {
      const pollInterval = this.options?.pollInterval || 1000;
      this.startPolling(pollInterval);
      serverLogger.info(`[EventMcpClient] Connected to ${this.name} (mode: polling, interval: ${pollInterval}ms)`);
    }

    this.status = EventSourceStatus.RUNNING;
  }

  /**
   * 创建传输层
   */
  private createTransport(): StdioClientTransport | StreamableHTTPClientTransport {
    if (this.config.type === "local") {
      const [cmd, ...args] = this.config.command!;
      return new StdioClientTransport({
        command: cmd,
        args,
        env: { ...process.env as Record<string, string>, ...this.config.environment },
        stderr: "pipe",
      });
    } else {
      return new StreamableHTTPClientTransport(new URL(this.config.url!), {
        requestInit: this.config.headers ? { headers: this.config.headers } : undefined,
      });
    }
  }

  /**
   * 设置 Notification 处理器（仅 Remote 模式）
   * 使用 MCP SDK 的 fallbackNotificationHandler 来处理 Server → Client 推送
   */
  private setupNotificationHandler(): void {
    if (!this.client) return;

    this.client.fallbackNotificationHandler = async (notification: Notification) => {
      if (notification.method === "notifications/eventsource/emitted") {
        const data = (notification.params as any)?.data as Record<string, unknown>;
        if (data) {
          await this.handleEvent(data);
        }
      }
    };
    
    serverLogger.debug(`[EventMcpClient] Notification handler set up for ${this.name}`);
  }

  /**
   * 轮询获取待处理事件（仅 Local/Stdio 模式）
   * 调用 Server 的 list_pending_events 工具获取事件
    */
  private startPolling(interval: number): void {
    let consecutiveErrors = 0;
    const maxErrorsBeforeSilence = 5;
    
    this.pollInterval = setInterval(async () => {
      try {
        if (!this.client) return;

        const result = await (this.client as any).callTool({
          name: "list_pending_events",
          arguments: {}
        });

        if (result?.content?.[0]?.text) {
          const text = result.content[0].text;
          // Check if it looks like JSON before parsing
          if (text.trim().startsWith('[') || text.trim().startsWith('{')) {
            try {
              const events = JSON.parse(text);
              if (Array.isArray(events)) {
                for (const rawEvent of events) {
                  await this.handleEvent(rawEvent);
                }
              }
              // Reset error counter on success
              consecutiveErrors = 0;
            } catch (parseError) {
              consecutiveErrors++;
              const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
              // Only log first few errors, then suppress
              if (consecutiveErrors <= maxErrorsBeforeSilence) {
                serverLogger.warn(`[EventMcpClient] JSON parse error for ${this.name}:`, { 
                  error: errorMsg,
                  preview: text.substring(0, 100)
                });
                if (consecutiveErrors === maxErrorsBeforeSilence) {
                  serverLogger.info(`[EventMcpClient] Suppressing further polling errors for ${this.name} after ${maxErrorsBeforeSilence} consecutive failures`);
                }
              }
            }
          } else {
            // Not JSON data, likely an error message from the server
            consecutiveErrors++;
            if (consecutiveErrors <= maxErrorsBeforeSilence) {
              serverLogger.warn(`[EventMcpClient] Non-JSON response from ${this.name}:`, { 
                preview: text.substring(0, 100) 
              });
            }
          }
        }
      } catch (error) {
        consecutiveErrors++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Only log first few errors
        if (consecutiveErrors <= maxErrorsBeforeSilence) {
          serverLogger.warn(`[EventMcpClient] Polling error for ${this.name}:`, { error: errorMsg });
        }
      }
    }, interval);
  }

  /**
   * 处理收到的事件
   * 直接调用 env.publishEvent() 发布到 EnvEventBus
   */
  private async handleEvent(rawEvent: Record<string, unknown>): Promise<void> {
    const envEvent: EnvEvent = {
      id: (rawEvent.id as string) || crypto.randomUUID(),
      type: rawEvent.type as string,
      timestamp: (rawEvent.timestamp as number) || Date.now(),
      metadata: {
        source: (rawEvent.metadata as Record<string, unknown>)?.source as string || this.name,
        source_name: this.name,
        ...(rawEvent.metadata as Record<string, unknown>),
      },
      payload: rawEvent.payload || {},
    };

    await this.env.publishEvent(envEvent);
    this.eventCount++;
  }

  /**
   * 断开连接
   */
  async disconnect(): Promise<void> {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
    
    if (this.client) {
      await this.client.close();
      this.client = undefined;
    }
    
    this.status = EventSourceStatus.STOPPED;
    serverLogger.info(`[EventMcpClient] Disconnected from ${this.name}`);
  }

  /**
   * 获取状态
   */
  getStatus(): EventSourceStatus {
    return this.status;
  }

  /**
   * 获取名称
   */
  getName(): string {
    return this.name;
  }

  /**
   * 获取事件计数
   */
  getEventCount(): number {
    return this.eventCount;
  }
}
