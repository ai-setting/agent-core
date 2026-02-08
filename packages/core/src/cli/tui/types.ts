/**
 * @fileoverview TUI 类型定义
 * 
 * 参考 OpenCode 设计
 */

/**
 * 服务器发送的原始事件格式
 */
export interface TUIStreamEventRaw {
  type: string;
  properties: {
    sessionId?: string;
    messageId?: string;
    content?: string;
    delta?: string;
    toolName?: string;
    toolArgs?: Record<string, unknown>;
    toolCallId?: string;
    result?: unknown;
    success?: boolean;
    error?: string;
    code?: string;
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  };
  timestamp?: number;
}

/**
 * 客户端使用的扁平化事件格式
 */
export interface TUIStreamEvent {
  type: 
    | "stream.start" 
    | "stream.text" 
    | "stream.reasoning" 
    | "stream.tool.call" 
    | "stream.tool.result" 
    | "stream.completed" 
    | "stream.error"
    | "server.connected"
    | "server.heartbeat";
  sessionId?: string;
  messageId?: string;
  content?: string;
  delta?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
  result?: unknown;
  success?: boolean;
  error?: string;
  code?: string;
  timestamp?: number;
}

/**
 * 将原始事件转换为扁平化事件
 */
export function normalizeEvent(raw: TUIStreamEventRaw): TUIStreamEvent {
  return {
    type: raw.type as TUIStreamEvent["type"],
    sessionId: raw.properties?.sessionId,
    messageId: raw.properties?.messageId,
    content: raw.properties?.content,
    delta: raw.properties?.delta,
    toolName: raw.properties?.toolName,
    toolArgs: raw.properties?.toolArgs,
    toolCallId: raw.properties?.toolCallId,
    result: raw.properties?.result,
    success: raw.properties?.success,
    error: raw.properties?.error,
    code: raw.properties?.code,
    timestamp: raw.timestamp,
  };
}

/**
 * TUI 配置选项
 */
export interface TUIOptions {
  url: string;
  directory?: string;
  sessionID?: string;
  password?: string;
}

export interface TUIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  toolCalls?: TUIToolCall[];
}

export interface TUIToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "completed" | "error";
}

export interface TUIOptions {
  url: string;
  directory?: string;
  sessionID?: string;
  password?: string;
}
