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

export interface Environment {
  handle_query(query: string, context: Context): Promise<string>;
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
  createInvokeLLM,
  createSystem1IntuitiveReasoning,
  type InvokeLLMConfig,
  type LLMResult,
} from "./base/invoke-llm.js";
