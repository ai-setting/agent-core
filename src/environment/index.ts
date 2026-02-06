/**
 * @fileoverview Environment types and interfaces.
 */

import type { Context, Action, ToolResult, Tool, LLMStream, StreamHandler, LLMStreamEvent } from "../types";

export type StreamEventType = "text" | "reasoning" | "tool_call" | "tool_result" | "completed" | "error" | "start";

export interface StreamEvent {
  type: StreamEventType;
  content?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  tool_result?: unknown;
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
