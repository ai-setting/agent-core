/**
 * @fileoverview EventSource MCP 类型定义
 */

import { z } from "zod";

/**
 * EventSource 事件源类型
 */
export const EventSourceTypeSchema = z.enum(["local", "remote"]);

/**
 * EventSource 配置（复用 McpClientConfig 的结构）
 */
export const EventSourceConfigSchema = z
  .object({
    /** EventSource 名称 */
    name: z.string().min(1),
    /** 事件源类型 */
    type: EventSourceTypeSchema,
    /** 本地进程命令 */
    command: z.array(z.string()).optional(),
    /** 远程服务器 URL */
    url: z.string().url().optional(),
    /** 是否启用 */
    enabled: z.boolean().default(true),
    /** 超时时间（毫秒） */
    timeout: z.number().default(30000),
    /** HTTP 请求头 */
    headers: z.record(z.string()).optional(),
    /** 自定义元数据 */
    metadata: z.record(z.unknown()).optional(),
    /** 事件类型过滤器 */
    eventTypes: z.array(z.string()).optional(),
  })
  .refine(
    (data) => {
      if (data.type === "local") return data.command && data.command.length > 0;
      if (data.type === "remote") return data.enabled === false || (data.url && data.url.length > 0);
      return false;
    },
    {
      message: "Invalid configuration for EventSource type",
    }
  );

/**
 * 单个 EventSource 配置
 */
export interface EventSourceOptions {
  /** 事件类型过滤器 */
  eventTypes?: string[];
  /** 轮询间隔（仅 stdio 模式有效） */
  pollInterval?: number;
  /** 自定义元数据 */
  metadata?: Record<string, unknown>;
  /** 是否注册 MCP 工具到 Environment（默认 true） */
  registerTools?: boolean;
  /** MCP 工具名前缀（默认使用 EventSource 名称） */
  toolPrefix?: string;
}

/**
 * EventSource MCP 配置（在 mcp 配置中的 eventSources 字段）
 */
export const EventSourceMcpConfigSchema = z.object({
  /** 是否启用 EventSource 功能 */
  enabled: z.boolean().default(true),
  /** 是否自动启动 */
  autoStart: z.boolean().default(true),
  /** EventSource 配置映射 */
  sources: z.record(z.string(), z.object({
    name: z.string(),
    enabled: z.boolean().default(true),
    options: z.object({
      eventTypes: z.array(z.string()).optional(),
      pollInterval: z.number().optional(),
      metadata: z.record(z.unknown()).optional(),
      registerTools: z.boolean().optional(),
      toolPrefix: z.string().optional(),
    }).optional(),
  })).optional(),
});

/**
 * EventSource 状态
 */
export enum EventSourceStatus {
  STOPPED = "stopped",
  STARTING = "starting",
  RUNNING = "running",
  STOPPING = "stopping",
  ERROR = "error",
}

/**
 * EventSource 连接状态
 */
export interface EventSourceConnectionStatus {
  name: string;
  status: EventSourceStatus;
  error?: string;
  eventCount?: number;
}

/**
 * 事件元数据（从 EventSource MCP Server 接收）
 */
export interface EventSourceEvent {
  /** 事件类型 */
  type: string;
  /** 事件数据 */
  data: Record<string, unknown>;
  /** 事件时间戳 */
  timestamp?: number;
}

// ========== TypeScript 类型导出 ==========

export type EventSourceType = z.infer<typeof EventSourceTypeSchema>;
export type EventSourceConfig = z.infer<typeof EventSourceConfigSchema>;
export type EventSourceMcpConfig = z.infer<typeof EventSourceMcpConfigSchema>;
