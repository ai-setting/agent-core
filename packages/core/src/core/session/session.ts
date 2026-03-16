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
  static fork(sessionID: string, messageID?: string): Session {
    const original = Storage.getSession(sessionID);
    if (!original) {
      throw new Error(`Session not found: ${sessionID}`);
    }

    const forked = new Session({
      title: `${original.title} (fork)`,
      directory: original.directory,
      parentID: sessionID,
    });

    const messages = original.getMessages();
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
   */
  @Traced({ name: "session.getMessages", log: true, recordParams: true, recordResult: false })
  getMessages(limit?: number): MessageWithParts[] {
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
    const history = sessionToHistory(this);
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
   *
   * @param env - Environment with handle_query method
   * @param options - Compaction configuration options
   * @returns The new compacted child session
   */
  @Traced({ name: "session.compact", log: true, recordParams: true, recordResult: false })
  async compact(
    env: {
      handle_query: (input: string, ctx: any, history: Array<{ role: string; content: any }>) => Promise<string>;
    },
    options?: CompactionOptions
  ): Promise<Session> {
    const keepMessages = options?.keepMessages ?? 50;
    const customPrompt = options?.customPrompt;

    const recentMessages = this.getMessages(keepMessages);

    const defaultPrompt = `请用简洁的语言总结上面的对话，包含：
1. 用户的主要需求
2. 关键讨论点和决定
3. 当前状态和后续方向`;

    const compactionPrompt = customPrompt ?? defaultPrompt;

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

    const fullPrompt = `${compactionPrompt}

=== 对话历史 ===
${historyForLLM}

=== 结束 ===

请总结：`;

    let summary = "Session summary unavailable";
    try {
      const llmHistory = [
        { role: "user", content: { type: "text", text: fullPrompt } }
      ];
      const result = await env.handle_query(fullPrompt, {}, llmHistory);
      if (result && typeof result === "string" && result.length > 0) {
        summary = result;
      }
    } catch (err) {
      console.warn(`Compaction failed: ${err}`);
    }

    const compactedSession = Session.createChild(this.id, `Compacted: ${this.title}`, this._info.directory);

    compactedSession.addSystemMessage(summary);

    return compactedSession;
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
   */
  @Traced({ name: "session.updateContextUsage", log: true, recordParams: true, recordResult: false })
  updateContextUsage(
    usage: {
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    },
    limit?: number
  ): void {
    const currentUsage = this._info.contextUsage;
    const now = Date.now();
    
    // Determine the context window limit to use
    // Priority: 1. Provided limit parameter, 2. Existing limit in contextUsage, 3. Default 8192
    const ctxLimit = limit || currentUsage?.contextWindow || 8192;
    
    // Calculate total tokens for percentage calculation (use latest value, not accumulated)
    const newTotalTokens = usage.totalTokens;

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
  }
}
