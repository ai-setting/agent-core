/**
 * @fileoverview Environment types and interfaces.
 */

import type { Context, Action, ToolResult, Tool, LLMStream, StreamHandler, LLMStreamEvent, ToolInfo } from "../types";
import type { LLMMessage, LLMOptions } from "./base/invoke-llm.js";

export type StreamEventType = "text" | "reasoning" | "tool_call" | "tool_result" | "completed" | "error" | "start";

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  delta?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_call_id?: string;
  tool_result?: unknown;
  error?: string;
  code?: string;
  metadata?: Record<string, unknown>;
}

export type MessageContent =
  | TextContent
  | ImageContent
  | AudioContent
  | FileContent
  | ToolContent
  | ReasoningContent
  | CompactionContent;

export interface TextContent {
  type: "text";
  text: string;
}

export interface ToolContent {
  type: "tool";
  tool_call_id?: string;
  name: string;
  content: string;
}

export interface ReasoningContent {
  type: "reasoning";
  reasoning: string;
}

export interface CompactionContent {
  type: "compaction";
  summary: string;
  removed_messages: number;
  original_message_count: number;
}

export interface ImageContent {
  type: "image";
  image: string;
  mimeType?: string;
}

export interface AudioContent {
  type: "audio";
  audio: string;
  mimeType?: string;
}

export interface FileContent {
  type: "file";
  url: string;
  mimeType: string;
  filename?: string;
}

export interface HistoryMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: MessageContent | MessageContent[];
  name?: string;
}

/** 与 env spec AgentSpec 结构兼容，用于从 Environment 推导 profiles/agents */
export interface EnvironmentAgentSpec {
  id: string;
  role: "primary" | "sub";
  promptId?: string;
  promptOverride?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  metadata?: Record<string, unknown>;
}

/** 与 env spec EnvProfile 结构兼容，用于从 Environment 推导 listProfiles/listAgents/getAgent */
export interface EnvironmentProfile {
  id: string;
  displayName: string;
  primaryAgents: EnvironmentAgentSpec[];
  subAgents?: EnvironmentAgentSpec[];
  metadata?: Record<string, unknown>;
}

/** 与 env spec LogEntry 结构兼容 */
export type EnvironmentLogLevel = "debug" | "info" | "warn" | "error";

export interface EnvironmentLogEntry {
  timestamp: string;
  level: EnvironmentLogLevel;
  message: string;
  sessionId?: string;
  agentId?: string;
  toolName?: string;
  context?: Record<string, unknown>;
}

/** queryLogs 参数，与 env spec 一致 */
export interface EnvironmentQueryLogsParams {
  sessionId?: string;
  agentId?: string;
  level?: EnvironmentLogLevel;
  since?: string;
  until?: string;
  limit?: number;
}

export interface Environment {
  handle_query(query: string, context?: Context, history?: HistoryMessage[]): Promise<string>;
  handle_action(action: Action, context: Context): Promise<ToolResult>;
  getTools(): Tool[];
  getPrompt(prompt_id: string): Prompt | undefined;
  subscribe(handler: StreamHandler): void;
  unsubscribe(handler: StreamHandler): void;
  getStream(stream_id: string): LLMStream | undefined;
  pushToSubscribers(event: LLMStreamEvent): void;
  onStreamEvent?(event: StreamEvent, context: Context): void | Promise<void>;
  /**
   * Invoke LLM as a native environment capability
   */
  invokeLLM(messages: LLMMessage[], tools?: ToolInfo[], context?: Context, options?: Omit<LLMOptions, "messages" | "tools">): Promise<ToolResult>;

  /**
   * 可选：返回当前 Environment 的 profiles（用于 env MCP describe/list_profiles/list_agents/get_agent）。
   * 未实现时由 env_spec 从 getPrompt/getTools 推导默认 profile。
   */
  getProfiles?(): EnvironmentProfile[] | Promise<EnvironmentProfile[]>;

  /**
   * 可选：查询结构化日志（用于 env MCP query_logs、capabilities.logs）。
   * 未实现则不暴露 query_logs，capabilities.logs 为 false。
   */
  queryLogs?(params: EnvironmentQueryLogsParams): Promise<EnvironmentLogEntry[]>;
}

export interface Prompt {
  id: string;
  content: string;
  version?: string;
}

export {
  TimeoutManager,
  RetryManager,
  ConcurrencyManager,
  ErrorRecovery,
  DefaultMetricsCollector,
} from "./base/index.js";
export { BaseEnvironment } from "./base/base-environment.js";
export * from "./expend/os/index.js";
