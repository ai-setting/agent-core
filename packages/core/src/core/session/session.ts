/**
 * @fileoverview Session class - Core session management.
 *
 * Features:
 * - Create and manage sessions
 * - Add and retrieve messages
 * - Track parent-child relationships
 * - Convert to Agent Core history format
 * - Message limit enforcement (100 messages)
 * - Session compaction for long conversations
 *
 * Based on OpenCode's Session architecture.
 */

import type {
  SessionInfo,
  MessageInfo,
  SessionCreateOptions,
  Part,
  TextPart,
  ReasoningPart,
  FilePart,
  ToolPart,
  MessageWithParts,
  ContextUsage,
} from "./types";
import type { ModelMessage } from "ai";
import { ID } from "./id";
import { Storage } from "./storage";
import { sessionToHistory } from "./history";
import { modelLimitsManager } from "./model-limits";
import { createLogger } from "../../utils/logger.js";
import { Traced } from "../../utils/wrap-function.js";

const sessionLogger = createLogger("session:addMessage", "server.log");

const DEFAULT_MESSAGE_LIMIT = Infinity;

/**
 * Compaction options for Session.compact().
 */
export interface CompactionOptions {
  /** Maximum number of messages to keep before compaction (default: 50) */
  keepMessages?: number;
  /** Custom prompt for compression (optional) */
  customPrompt?: string;
  /** Optional model to use for summary generation (faster/cheaper model recommended) */
  summaryModel?: string;
}

/**
 * Session class for managing conversation context.
 */
export class Session {
  private _info: SessionInfo;
  private _messages: Map<string, MessageWithParts> = new Map();
  private _messageOrder: string[] = [];
  private _metadata: Map<string, unknown> = new Map();
  private _historyLoaded: boolean = false;

  /**
   * Create a new session.
   */
  constructor(options: SessionCreateOptions = {}) {
    const now = Date.now();
    const isChild = !!options.parentID;

    this._info = {
      id: options.id ?? ID.descending("session"),
      parentID: options.parentID,
      title: options.title ?? (isChild ? "Child session" : "Session") + " - " + new Date().toISOString(),
      directory: options.directory ?? process.cwd(),
      time: options.time ?? {
        created: now,
        updated: now,
      },
      metadata: options.metadata,
    };

    if (options.metadata) {
      for (const [key, value] of Object.entries(options.metadata)) {
        this._metadata.set(key, value);
      }
    }

    // Set initial message count for persisted sessions
    if (options.messageCount && options.messageCount > 0) {
      // Create placeholder entries for message count
      for (let i = 0; i < options.messageCount; i++) {
        this._messageOrder.push(`placeholder_${i}`);
      }
    }

    // Only save if not loading from storage
    if (!options._isLoading) {
      Storage.saveSession(this);
    }

    // [DEBUG] Log session creation
    sessionLogger.info(`[Session] Created new session: id=${this.id}, title=${this.title}, messageCount=${options.messageCount ?? 0}, _isLoading=${options._isLoading ?? false}, timeCreated=${this._info.time.created}, now=${now}`);
  }

  /**
   * Create a new session.
   */
  @Traced({ name: "session.create", log: true, recordParams: true, recordResult: false })
  static create(options: SessionCreateOptions = {}): Session {
    return new Session(options);
  }

  /**
   * Get a session by ID.
   */
  @Traced({ name: "session.get", log: true, recordParams: true, recordResult: false })
  static get(id: string): Session | undefined {
    return Storage.getSession(id);
  }

  /**
   * List all sessions.
   */
  @Traced({ name: "session.list", log: true, recordParams: false, recordResult: false })
  static list(): Session[] {
    return Storage.listSessions();
  }

  /**
   * Create a child session.
   */
  @Traced({ name: "session.createChild", log: true, recordParams: true, recordResult: false })
  static createChild(parentID: string, title?: string, directory?: string): Session {
    return new Session({
      parentID,
      title: title ?? `Child of ${parentID}`,
      directory,
    });
  }

  /**
   * Fork a session from a specific message.
   */
  @Traced({ name: "session.fork", log: true, recordParams: true, recordResult: false })
  static async fork(sessionID: string, messageID?: string): Promise<Session> {
    const original = Storage.getSession(sessionID);
    if (!original) {
      throw new Error(`Session not found: ${sessionID}`);
    }

    const forked = new Session({
      title: `${original.title} (fork)`,
      directory: original.directory,
      parentID: sessionID,
    });

    const messages = await original.getMessages();
    const idMap = new Map<string, string>();

    for (const msg of messages) {
      if (messageID && msg.info.id < messageID) {
        continue;
      }

      const newID = ID.ascending("message");
      idMap.set(msg.info.id, newID);

      const copiedMessage: MessageWithParts = {
        info: {
          ...msg.info,
          id: newID,
          sessionID: forked.id,
          parentID: msg.info.parentID ? idMap.get(msg.info.parentID) : undefined,
        },
        parts: msg.parts.map((part) => ({
          ...part,
          id: ID.ascending("part"),
        })),
      };

      forked._messages.set(newID, copiedMessage);
      forked._messageOrder.push(newID);
    }

    Storage.saveSession(forked);
    return forked;
  }

  /**
   * Get child sessions.
   */
  @Traced({ name: "session.getChildren", log: true, recordParams: true, recordResult: false })
  static getChildren(parentID: string): Session[] {
    const infos = Storage.getChildren(parentID);
    return infos.map((info) => Storage.getSession(info.id)).filter((s): s is Session => s !== undefined);
  }

  /**
   * Add a message to the session.
   */
  @Traced({ name: "session.addMessage", log: true, recordParams: true, recordResult: false })
  addMessage(info: MessageInfo, parts: Part[] = []): string {
    const message: MessageWithParts = {
      info,
      parts,
    };

    this._messages.set(info.id, message);
    this._messageOrder.push(info.id);

    while (this._messageOrder.length > DEFAULT_MESSAGE_LIMIT) {
      const toRemove = this._messageOrder.shift()!;
      this._messages.delete(toRemove);
    }

    this._info.time.updated = Date.now();
    Storage.saveSession(this);
    Storage.saveMessage(this.id, message);

    // [DEBUG] Log after addMessage
    sessionLogger.info(`[Session] addMessage: sessionId=${this.id}, messageId=${info.id}, role=${info.role}, totalMessages=${this._messageOrder.length}, _messages.size=${this._messages.size}`);

    return info.id;
  }

  /**
   * Add a message directly from AI SDK ModelMessage format.
   * This is the unified method for adding messages from the Agent.
   */
  @Traced({ name: "session.addMessageFromModelMessage", log: true, recordParams: true, recordResult: false })
  addMessageFromModelMessage(message: ModelMessage): string {
    const id = ID.ascending("message");
    const now = Date.now();
    
    let role: MessageInfo["role"] = message.role as MessageInfo["role"];
    if (role === "system") {
      role = "system";
    }

    const parts: Part[] = [];

    // addMessageFromModelMessage debug // 已精简
    
    const normalizeToolCallId = (id: string): string => {
      return id.replace(/[^a-zA-Z0-9_-]/g, "_");
    };

    const content = message.content;
    
    // content debug // 已精简
    if (Array.isArray(content)) {
      for (const part of content) {
        // part type debug // 已精简
        if (part.type === "tool-call") {
          // toolCallId debug // 已精简
        } else if (part.type === "tool-result") {
          // toolCallId debug // 已精简
        }
      }
    }

    if (typeof content === "string") {
      if (content) {
        const textPart: TextPart = {
          id: ID.ascending("part"),
          type: "text",
          text: content,
        };
        parts.push(textPart);
      }
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text") {
          const textPart: TextPart = {
            id: ID.ascending("part"),
            type: "text",
            text: part.text || "",
          };
          parts.push(textPart);
        } else if (part.type === "tool-call") {
          const toolPart: ToolPart = {
            id: ID.ascending("part"),
            type: "tool",
            callID: normalizeToolCallId(part.toolCallId || `call_${Date.now()}`),
            tool: part.toolName,
            state: "pending",
            input: part.input as Record<string, unknown>,
          };
          parts.push(toolPart);
        } else if (part.type === "tool-result") {
          const toolPart: ToolPart = {
            id: ID.ascending("part"),
            type: "tool",
            callID: normalizeToolCallId(part.toolCallId || `call_${Date.now()}`),
            tool: part.toolName || "unknown",
            state: "completed",
            input: {} as Record<string, unknown>,
            output: typeof part.output === "string" ? part.output : JSON.stringify(part.output),
            time: { start: now, end: now },
          };
          parts.push(toolPart);
        } else if (part.type === "file") {
          const filePart: FilePart = {
            id: ID.ascending("part"),
            type: "file",
            mime: (part as any).mediaType || "application/octet-stream",
            url: (part as any).url || "",
            filename: (part as any).filename,
          };
          parts.push(filePart);
        }
      }
    }

    const info: MessageInfo = {
      id,
      sessionID: this.id,
      role,
      timestamp: now,
    };

    return this.addMessage(info, parts);
  }

  /**
   * Add a user message.
   */
  @Traced({ name: "session.addUserMessage", log: true, recordParams: true, recordResult: false })
  addUserMessage(content: string, metadata?: Record<string, unknown>): string {
    const id = ID.ascending("message");
    const info: MessageInfo = {
      id,
      sessionID: this.id,
      role: "user",
      timestamp: Date.now(),
      metadata,
    };

    const textPart: TextPart = {
      id: ID.ascending("part"),
      type: "text",
      text: content,
    };

    return this.addMessage(info, [textPart]);
  }

  /**
   * Add an assistant message.
   */
  @Traced({ name: "session.addAssistantMessage", log: true, recordParams: true, recordResult: false })
  addAssistantMessage(content: string, metadata?: Record<string, unknown>): string {
    const id = ID.ascending("message");
    const info: MessageInfo = {
      id,
      sessionID: this.id,
      role: "assistant",
      timestamp: Date.now(),
      metadata,
    };

    const textPart: TextPart = {
      id: ID.ascending("part"),
      type: "text",
      text: content,
    };

    return this.addMessage(info, [textPart]);
  }

  /**
   * Add reasoning content.
   */
  @Traced({ name: "session.addReasoning", log: true, recordParams: true, recordResult: false })
  addReasoning(text: string, metadata?: Record<string, unknown>): string {
    const id = ID.ascending("message");
    const now = Date.now();
    const info: MessageInfo = {
      id,
      sessionID: this.id,
      role: "assistant",
      timestamp: now,
      metadata,
    };

    const reasoningPart: ReasoningPart = {
      id: ID.ascending("part"),
      type: "reasoning",
      text,
      time: { start: now },
    };

    return this.addMessage(info, [reasoningPart]);
  }

  /**
   * Add a file attachment.
   */
  @Traced({ name: "session.addFile", log: true, recordParams: true, recordResult: false })
  addFile(url: string, mime: string, filename?: string): string {
    const id = ID.ascending("message");
    const info: MessageInfo = {
      id,
      sessionID: this.id,
      role: "user",
      timestamp: Date.now(),
    };

    const filePart: FilePart = {
      id: ID.ascending("part"),
      type: "file",
      mime,
      url,
      filename,
    };

    return this.addMessage(info, [filePart]);
  }

  /**
   * Add a tool call result.
   */
  @Traced({ name: "session.addToolMessage", log: true, recordParams: true, recordResult: false })
  addToolMessage(
    toolName: string,
    callID: string,
    output: string,
    input: Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): string {
    const id = ID.ascending("message");
    const now = Date.now();
    const info: MessageInfo = {
      id,
      sessionID: this.id,
      role: "tool",
      timestamp: now,
      metadata,
    };

    const toolPart: ToolPart = {
      id: ID.ascending("part"),
      type: "tool",
      callID,
      tool: toolName,
      state: "completed",
      input,
      output,
      time: { start: now, end: now },
    };

    return this.addMessage(info, [toolPart]);
  }

  /**
   * Track a tool call in the current assistant message.
   */
  @Traced({ name: "session.addToolCall", log: true, recordParams: true, recordResult: false })
  addToolCall(toolName: string, callID: string, input: Record<string, unknown>): void {
    const messageID = this._messageOrder[this._messageOrder.length - 1];
    const message = this._messages.get(messageID);

    if (message && message.info.role === "assistant") {
      const toolPart: ToolPart = {
        id: ID.ascending("part"),
        type: "tool",
        callID,
        tool: toolName,
        state: "pending",
        input,
        time: { start: Date.now() },
      };
      message.parts.push(toolPart);
      Storage.saveMessage(this.id, message);
    }
  }

  /**
   * Update a tool call result.
   */
  @Traced({ name: "session.updateToolResult", log: true, recordParams: true, recordResult: false })
  updateToolResult(callID: string, output: string, error?: string): void {
    const now = Date.now();

    for (const messageID of this._messageOrder) {
      const message = this._messages.get(messageID);
      if (!message) continue;

      const toolPart = message.parts.find(
        (p): p is ToolPart => p.type === "tool" && (p as ToolPart).callID === callID
      );

      if (toolPart) {
        toolPart.state = error ? "error" : "completed";
        if (error) {
          toolPart.error = error;
        } else {
          toolPart.output = output;
        }
        toolPart.time = { ...toolPart.time!, end: now };
        Storage.saveMessage(this.id, message);
        break;
      }
    }
  }

  /**
   * Get messages in chronological order.
   * Note: This triggers lazy loading if messages are not yet loaded.
   */
  @Traced({ name: "session.getMessages", log: true, recordParams: true, recordResult: false })
  async getMessages(limit?: number): Promise<MessageWithParts[]> {
    // Lazy load messages if needed
    if (!this._historyLoaded && this._messageOrder.length > this._messages.size) {
      sessionLogger.info(`[Session] getMessages: lazy loading messages for session ${this.id}, placeholders=${this._messageOrder.length}, loaded=${this._messages.size}`);
      await Storage.loadSessionMessages(this.id);
      this._historyLoaded = true;
    }

    const messages = this._messageOrder
      .map((id) => this._messages.get(id))
      .filter((m): m is MessageWithParts => m !== undefined);

    if (limit && limit > 0) {
      return messages.slice(-limit);
    }

    return messages;
  }

  /**
   * Get a specific message.
   */
  @Traced({ name: "session.getMessage", log: true, recordParams: true, recordResult: false })
  getMessage(messageID: string): MessageWithParts | undefined {
    return this._messages.get(messageID);
  }

  /**
   * Get the last message.
   */
  @Traced({ name: "session.getLastMessage", log: true, recordParams: false, recordResult: false })
  getLastMessage(): MessageWithParts | undefined {
    if (this._messageOrder.length === 0) {
      return undefined;
    }
    return this._messages.get(this._messageOrder[this._messageOrder.length - 1]);
  }

  /**
   * Convert session messages to Agent Core history format.
   */
  @Traced({ name: "session.toHistory", log: true, recordParams: false, recordResult: true })
  async toHistory(): Promise<any[]> {
    // Lazy load messages from storage on first call
    // Check if we have placeholder messages that need to be loaded
    if (!this._historyLoaded && this._messageOrder.length > this._messages.size) {
      sessionLogger.info(`[Session] toHistory: loading messages from storage for session ${this.id}, placeholders=${this._messageOrder.length}, loaded=${this._messages.size}`);
      await Storage.loadSessionMessages(this.id);
    }
    
    // Mark as loaded to prevent reloading on subsequent calls
    this._historyLoaded = true;
    
    // [DEBUG] Log before toHistory
    sessionLogger.info(`[Session] toHistory: sessionId=${this.id}, _messageOrder.length=${this._messageOrder.length}, _messages.size=${this._messages.size}`);
    const history = await sessionToHistory(this);
    // [DEBUG] Log after toHistory
    sessionLogger.info(`[Session] toHistory result: sessionId=${this.id}, history.length=${history.length}`);
    return history;
  }

  /**
   * Delete this session and all its messages.
   */
  @Traced({ name: "session.delete", log: true, recordParams: false, recordResult: false })
  delete(): void {
    const children = Storage.getChildren(this.id);
    for (const childInfo of children) {
      const child = Storage.getSession(childInfo.id);
      child?.delete();
    }

    Storage.deleteSession(this.id);
  }

  /**
   * Update session metadata.
   */
  @Traced({ name: "session.setMetadata", log: true, recordParams: true, recordResult: false })
  setMetadata(key: string, value: unknown): void {
    this._metadata.set(key, value);
    this._info.metadata = Object.fromEntries(this._metadata);
    this._info.time.updated = Date.now();
    Storage.saveSession(this);
  }

  /**
   * Get session metadata.
   */
  @Traced({ name: "session.getMetadata", log: true, recordParams: true, recordResult: false })
  getMetadata(key: string): unknown {
    return this._metadata.get(key);
  }

  /**
   * Update session title.
   */
  @Traced({ name: "session.setTitle", log: true, recordParams: true, recordResult: false })
  setTitle(title: string): void {
    this._info.title = title;
    this._info.time.updated = Date.now();
    Storage.saveSession(this);
  }

  /**
   * Update file change summary.
   */
  @Traced({ name: "session.setSummary", log: true, recordParams: true, recordResult: false })
  setSummary(additions: number, deletions: number, files: number): void {
    this._info.summary = { additions, deletions, files };
    this._info.time.updated = Date.now();
    Storage.saveSession(this);
  }

  get id(): string {
    return this._info.id;
  }

  get parentID(): string | undefined {
    return this._info.parentID;
  }

  get title(): string {
    return this._info.title;
  }

  get directory(): string {
    return this._info.directory;
  }

  get createdAt(): number {
    return this._info.time.created;
  }

  get updatedAt(): number {
    return this._info.time.updated;
  }

  get summary(): SessionInfo["summary"] {
    return this._info.summary;
  }

  get metadata(): Record<string, unknown> | undefined {
    return this._info.metadata;
  }

  get messageCount(): number {
    return this._messageOrder.length;
  }

  /**
   * Load messages from storage (used during Storage initialization)
   */
  @Traced({ name: "session.loadMessages", log: true, recordParams: true, recordResult: false })
  loadMessages(messages: MessageWithParts[]): void {
    for (const msg of messages) {
      this._messages.set(msg.info.id, msg);
      this._messageOrder.push(msg.info.id);
    }
  }

  /**
   * Add a system message.
   */
  @Traced({ name: "session.addSystemMessage", log: true, recordParams: true, recordResult: false })
  addSystemMessage(content: string, metadata?: Record<string, unknown>): string {
    const id = ID.ascending("message");
    const info: MessageInfo = {
      id,
      sessionID: this.id,
      role: "system",
      timestamp: Date.now(),
      metadata,
    };

    const textPart: TextPart = {
      id: ID.ascending("part"),
      type: "text",
      text: content,
    };

    return this.addMessage(info, [textPart]);
  }

  /**
   * Get the info object.
   */
  get info(): SessionInfo {
    return { ...this._info };
  }

  /**
   * Compress the session by creating a child session with a summary.
   * Uses invokeLLM for direct LLM call (not handle_query).
   *
   * @param env - Environment with invokeLLM method
   * @param options - Compaction configuration options
   * @returns The new compacted child session
   */
  @Traced({ name: "session.compact", log: true, recordParams: true, recordResult: false })
  async compact(
    env: {
      invokeLLM: (
        messages: import("ai").ModelMessage[],
        tools?: import("../types/tool.js").ToolInfo[],
        context?: import("../environment/types.js").Context,
        options?: import("../environment/types.js").LLMOptions
      ) => Promise<import("../types/tool.js").ToolResult>;
    },
    options?: CompactionOptions
  ): Promise<Session> {
    const keepMessages = options?.keepMessages ?? 50;
    const customPrompt = options?.customPrompt;

    const recentMessages = await this.getMessages(keepMessages);

    // Use JSON format prompt for structured summary
    const compactionPrompt = customPrompt ?? `你是一个对话摘要专家。请仔细阅读以下对话历史，然后生成一个简洁的JSON格式摘要。

请按照以下JSON格式输出：
{
  "user_intent": "用户的主要需求或问题",
  "key_decisions": ["关键决定1", "关键决定2"],
  "current_status": "当前任务的进度或状态",
  "next_steps": ["待完成的步骤1", "待完成的步骤2"],
  "important_context": ["重要的上下文信息1", "重要的上下文信息2"]
}

## 对话历史

{{HISTORY}}

## 输出要求

1. 只输出JSON，不要有其他文字
2. 如果某个字段没有信息，使用空数组 [] 或 "无"
3. 保持简洁，每项不超过50个字
4. 重要上下文应该包含：使用的工具、修改的文件、重要的错误或解决方案

请生成摘要：`;

    const historyForLLM = recentMessages.map(msg => {
      const parts = msg.parts.map(part => {
        if (part.type === "text") return (part as TextPart).text;
        if (part.type === "tool") {
          const tool = part as ToolPart;
          return `[Tool: ${tool.tool}] ${tool.state === "completed" ? tool.output : "(pending)"}`;
        }
        return "";
      }).filter(Boolean).join("\n");
      return `[${msg.info.role}] ${parts}`;
    }).join("\n\n");

    const fullPrompt = compactionPrompt.replace("{{HISTORY}}", historyForLLM);

    let summary = "Session summary unavailable";
    try {
      // Use invokeLLM - direct LLM call, no agent run
      const result = await env.invokeLLM(
        [
          {
            role: "user",
            content: {
              type: "text" as const,
              text: fullPrompt,
            },
          },
        ],
        [], // No tools needed for summarization
        { session_id: this.id }, // Pass session context
        {
          maxTokens: 2000,
          summaryModel: options?.summaryModel, // Optional: use different model for summary
        } as any
      );

      if (result.success && result.output) {
        // Try to parse JSON summary
        try {
          const outputText = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
          const parsed = JSON.parse(outputText);
          // Format as readable text
          summary = this.formatSummaryAsText(parsed);
        } catch {
          // JSON parse failed, use raw output
          summary = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
        }
      }
    } catch (err) {
      console.warn(`[Session] Compaction invokeLLM failed:`, err);
    }

    const compactedSession = Session.createChild(this.id, `Compacted: ${this.title}`, this._info.directory);

    compactedSession.addSystemMessage(summary);

    return compactedSession;
  }

  /**
   * Format JSON summary as readable text
   */
  private formatSummaryAsText(parsed: Record<string, any>): string {
    const parts: string[] = [];
    
    if (parsed.user_intent && parsed.user_intent !== "无") {
      parts.push(`用户需求: ${parsed.user_intent}`);
    }
    
    if (parsed.key_decisions && Array.isArray(parsed.key_decisions) && parsed.key_decisions.length > 0) {
      parts.push(`关键决定: ${parsed.key_decisions.join(", ")}`);
    }
    
    if (parsed.current_status && parsed.current_status !== "无") {
      parts.push(`当前状态: ${parsed.current_status}`);
    }
    
    if (parsed.next_steps && Array.isArray(parsed.next_steps) && parsed.next_steps.length > 0) {
      parts.push(`后续步骤: ${parsed.next_steps.join(", ")}`);
    }
    
    if (parsed.important_context && Array.isArray(parsed.important_context) && parsed.important_context.length > 0) {
      parts.push(`重要上下文: ${parsed.important_context.join(", ")}`);
    }
    
    return parts.join("\n") || "Session summary unavailable";
  }

  /**
   * Get context usage statistics for this session.
   * @returns ContextUsage object with aggregated token usage or undefined if no usage recorded
   */
  @Traced({ name: "session.getContextStats", log: true, recordParams: false, recordResult: false })
  getContextStats(): ContextUsage | undefined {
    return this._info.contextUsage;
  }

  /**
   * Update context usage statistics with new usage data from an LLM response.
   * This method accumulates usage across multiple requests within the session.
   * @param usage - Usage information from the LLM response
   * @param limit - Optional context window limit for calculating usage percentage
   * @param env - Optional environment for triggering compaction
   * @param modelId - Optional model ID for getting compaction threshold
   */
  @Traced({ name: "session.updateContextUsage", log: true, recordParams: true, recordResult: false })
  async updateContextUsage(
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    },
    limit?: number,
    env?: {
      invokeLLM: (
        messages: import("ai").ModelMessage[],
        tools?: import("../types/tool.js").ToolInfo[],
        context?: import("../environment/types.js").Context,
        options?: import("../environment/types.js").LLMOptions
      ) => Promise<import("../types/tool.js").ToolResult>;
    },
    modelId?: string
  ): Promise<void> {
    const currentUsage = this._info.contextUsage;
    const now = Date.now();
    
    // Determine the context window limit to use
    // Priority: 1. Provided limit parameter, 2. Existing limit in contextUsage, 3. Default 8192
    const ctxLimit = limit || currentUsage?.contextWindow || 8192;
    
    // Calculate total tokens for percentage calculation (use latest value, not accumulated)
    const newTotalTokens = usage.totalTokens;

    // Get compaction threshold from ModelLimitsManager
    const modelLimits = modelId ? await modelLimitsManager.getLimits(modelId) : null;
    const threshold = modelLimits?.compactionThreshold ?? 0.8; // Default 80%
    const thresholdPercent = threshold * 100;

    if (currentUsage) {
      // Update with latest usage (not accumulated - the usage.totalTokens is already the full context size for this request)
      this._info.contextUsage = {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        contextWindow: ctxLimit,
        usagePercent: Math.round((newTotalTokens / ctxLimit) * 100),
        requestCount: currentUsage.requestCount + 1,
        lastUpdated: now,
        compacted: currentUsage.compacted,
        compactedSessionId: currentUsage.compactedSessionId,
      };
    } else {
      // Initialize usage
      this._info.contextUsage = {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        contextWindow: ctxLimit,
        usagePercent: Math.round((usage.totalTokens / ctxLimit) * 100),
        requestCount: 1,
        lastUpdated: now,
      };
    }

    this._info.time.updated = now;
    Storage.saveSession(this);
    
    sessionLogger.info(`[Session] Updated context usage: sessionId=${this.id}, totalTokens=${this._info.contextUsage.totalTokens}, contextWindow=${ctxLimit}, usagePercent=${this._info.contextUsage.usagePercent}%, requestCount=${this._info.contextUsage.requestCount}`);

    // Check if should trigger auto-compaction
    const usagePercent = this._info.contextUsage.usagePercent;
    if (usagePercent >= thresholdPercent && !this._info.contextUsage?.compacted && env) {
      // Trigger compaction asynchronously
      this.triggerCompaction(env, modelId).catch(err => {
        console.error(`[Session] Auto-compaction failed:`, err);
      });
    }
  }

  /**
   * Trigger session compaction asynchronously
   */
  private async triggerCompaction(
    env: {
      invokeLLM: (
        messages: import("ai").ModelMessage[],
        tools?: import("../types/tool.js").ToolInfo[],
        context?: import("../environment/types.js").Context,
        options?: import("../environment/types.js").LLMOptions
      ) => Promise<import("../types/tool.js").ToolResult>;
    },
    modelId?: string
  ): Promise<void> {
    // Check if already compacted
    if (this._info.contextUsage?.compacted) {
      return;
    }

    // Mark as compacted to prevent duplicate triggers
    this._info.contextUsage = {
      ...this._info.contextUsage!,
      compacted: true,
    };

    sessionLogger.info(`[Session] Triggering auto-compaction for session: ${this.id}`);

    try {
      const compactedSession = await this.compact(env, {
        keepMessages: 20,
        summaryModel: modelId, // Use same model or configure different one
      });

      // Update with compacted session info
      this._info.contextUsage = {
        ...this._info.contextUsage!,
        compactedSessionId: compactedSession.id,
      };

      Storage.saveSession(this);
      
      sessionLogger.info(`[Session] Auto-compaction completed: ${this.id} -> ${compactedSession.id}`);
    } catch (err) {
      // Reset compacted flag if failed
      this._info.contextUsage = {
        ...this._info.contextUsage!,
        compacted: false,
      };
      throw err;
    }
  }
}
