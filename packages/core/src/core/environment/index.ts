/**
 * @fileoverview Environment types and interfaces.
 */

import type { Context, Action, ToolResult, Tool, LLMStream, StreamHandler, LLMStreamEvent, ToolInfo } from "../types";
import type { LLMOptions } from "./base/invoke-llm.js";
import type { Session, SessionCreateOptions } from "../session/index.js";
import type { SkillInfo } from "./skills/types.js";
import type { ModelMessage } from "ai";

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

// Note: HistoryMessage is removed. Use ModelMessage from 'ai' SDK directly.

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

/**
 * 行为规范（完整）
 * 包含环境级规则 + agent 特定 prompt 的组合
 */
export interface BehaviorSpec {
  /** 环境名称 */
  envName: string;
  /** Agent ID */
  agentId: string;
  /** Agent 角色 */
  agentRole: "primary" | "sub";
  
  /** 环境级规则（所有 agent 共享） */
  envRules: string;
  /** Agent 特定 prompt（来自 promptId 或 promptOverride） */
  agentPrompt: string;
  
  /** 组合后的完整 system prompt */
  combinedPrompt: string;
  
  /** 工具权限（用于过滤传给 LLM 的 tools 参数） */
  allowedTools?: string[];
  deniedTools?: string[];
  
  /** 元数据 */
  metadata?: {
    lastUpdated?: string;
    version?: string;
  };
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
  handle_query(query: string, context?: Context, history?: import("ai").ModelMessage[]): Promise<string>;
  handle_action(action: Action, context: Context): Promise<ToolResult>;
  getTools(): Tool[];
  getPrompt(prompt_id: string): Prompt | undefined;
  /**
   * 从配置加载 prompts（由 ServerEnvironment 初始化时调用）
   */
  loadPromptsFromConfig?(loadedPrompts: { id: string; content: string }[]): void;
  subscribe(handler: StreamHandler): void;
  unsubscribe(handler: StreamHandler): void;
  getStream(stream_id: string): LLMStream | undefined;
  pushToSubscribers(event: LLMStreamEvent): void;
  onStreamEvent?(event: StreamEvent, context: Context): void | Promise<void>;
  /**
   * Invoke LLM as a native environment capability
   */
  invokeLLM(messages: ModelMessage[], tools?: ToolInfo[], context?: Context, options?: Omit<LLMOptions, "messages" | "tools">): Promise<ToolResult>;

  /**
   * 获取指定 agent 的完整行为规范
   * 组合：环境级规则 + agent 特定 prompt
   * 
   * @param agentId - agent 标识，默认为 "system"
   */
  getBehaviorSpec?(agentId?: string): BehaviorSpec | Promise<BehaviorSpec>;
  
  /**
   * 获取环境级规则（所有 agent 共享）
   */
  getEnvRules?(): string | Promise<string>;
  
  /**
   * 刷新行为规范（从文件重新加载）
   */
  refreshBehaviorSpec?(): void | Promise<void>;
  
  /**
   * 根据权限过滤工具列表
   * 用于在 LLM 调用时过滤 tools 参数
   */
  filterToolsByPermission?(tools: Tool[], agentId?: string): Tool[];

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