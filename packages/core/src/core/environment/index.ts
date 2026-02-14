/**
 * @fileoverview Environment types and interfaces.
 */

import type { Context, Action, ToolResult, Tool, LLMStream, StreamHandler, LLMStreamEvent, ToolInfo } from "../types";
import type { LLMMessage, LLMOptions } from "./base/invoke-llm.js";
import type { Session, SessionCreateOptions } from "../session/index.js";
import type { SkillInfo } from "./skills/types.js";

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

/**
 * 供 env 推导 profiles/agents 用的 Agent 描述（仅定义在 core，env_spec 依赖此类型做推导，core 不依赖 env_spec）。
 */
export interface EnvironmentAgentSpec {
  id: string;
  role: "primary" | "sub";
  promptId?: string;
  promptOverride?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * 供 env 推导 listProfiles/listAgents/getAgent 用的 Profile 描述（仅定义在 core，env_spec 依赖此类型）。
 */
export interface EnvironmentProfile {
  id: string;
  displayName: string;
  primaryAgents: EnvironmentAgentSpec[];
  subAgents?: EnvironmentAgentSpec[];
  metadata?: Record<string, unknown>;
}

/** 供 queryLogs 使用的日志级别 */
export type EnvironmentLogLevel = "debug" | "info" | "warn" | "error";

/** 供 env 推导 query_logs 的日志条目（仅定义在 core）。 */
export interface EnvironmentLogEntry {
  timestamp: string;
  level: EnvironmentLogLevel;
  message: string;
  sessionId?: string;
  agentId?: string;
  toolName?: string;
  context?: Record<string, unknown>;
}

/** queryLogs 参数 */
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
   * 可选：返回当前 Environment 的 profiles，供 env_spec 推导 describeEnv/listProfiles/listAgents/getAgent。
   * 未实现时由 env_spec 从 getPrompt/getTools 推导默认 profile。
   */
  getProfiles?(): EnvironmentProfile[] | Promise<EnvironmentProfile[]>;

  /**
   * 可选：查询结构化日志，供 env_spec 暴露 query_logs、capabilities.logs。
   */
  queryLogs?(params: EnvironmentQueryLogsParams): Promise<EnvironmentLogEntry[]>;

  /**
   * 可选：创建会话，委托给 core/session。未实现则无 session 能力。
   */
  createSession?(options?: SessionCreateOptions): Session | Promise<Session>;

  /**
   * 可选：按 id 获取会话。
   */
  getSession?(id: string): Session | undefined | Promise<Session | undefined>;

  /**
   * 可选：列出所有会话。
   */
  listSessions?(): Session[] | Promise<Session[]>;

  /**
   * 可选：更新会话标题或 metadata。
   */
  updateSession?(
    id: string,
    payload: { title?: string; metadata?: Record<string, unknown> }
  ): void | Promise<void>;

  /**
   * 可选：删除会话。
   */
  deleteSession?(id: string): void | Promise<void>;

  /**
   * 获取所有已加载的 Skills 元信息
   */
  listSkills(): SkillInfo[];

  /**
   * 获取单个 Skill 元信息
   */
  getSkill(id: string): SkillInfo | undefined;

  /**
   * 获取 Skills 元信息用于 Tool Description
   */
  getSkillsInfoForToolDescription(): string;
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
export * from "./skills/index.js";
