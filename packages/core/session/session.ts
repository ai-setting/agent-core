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
} from "./types";
import { ID } from "./id";
import { Storage } from "./storage";
import { sessionToHistory } from "./history";

const DEFAULT_MESSAGE_LIMIT = 100;

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
      time: {
        created: now,
        updated: now,
      },
    };

    if (options.metadata) {
      for (const [key, value] of Object.entries(options.metadata)) {
        this._metadata.set(key, value);
      }
    }

    Storage.saveSession(this);
  }

  /**
   * Create a new session.
   */
  static create(options: SessionCreateOptions = {}): Session {
    return new Session(options);
  }

  /**
   * Get a session by ID.
   */
  static get(id: string): Session | undefined {
    return Storage.getSession(id);
  }

  /**
   * List all sessions.
   */
  static list(): Session[] {
    return Storage.listSessions();
  }

  /**
   * Create a child session.
   */
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
  static getChildren(parentID: string): Session[] {
    const infos = Storage.getChildren(parentID);
    return infos.map((info) => Storage.getSession(info.id)).filter((s): s is Session => s !== undefined);
  }

  /**
   * Add a message to the session.
   */
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

    return info.id;
  }

  /**
   * Add a user message.
   */
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
  getMessage(messageID: string): MessageWithParts | undefined {
    return this._messages.get(messageID);
  }

  /**
   * Get the last message.
   */
  getLastMessage(): MessageWithParts | undefined {
    if (this._messageOrder.length === 0) {
      return undefined;
    }
    return this._messages.get(this._messageOrder[this._messageOrder.length - 1]);
  }

  /**
   * Convert session messages to Agent Core history format.
   */
  toHistory(): any[] {
    return sessionToHistory(this);
  }

  /**
   * Delete this session and all its messages.
   */
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
  setMetadata(key: string, value: unknown): void {
    this._metadata.set(key, value);
    this._info.metadata = Object.fromEntries(this._metadata);
    this._info.time.updated = Date.now();
    Storage.saveSession(this);
  }

  /**
   * Get session metadata.
   */
  getMetadata(key: string): unknown {
    return this._metadata.get(key);
  }

  /**
   * Update session title.
   */
  setTitle(title: string): void {
    this._info.title = title;
    this._info.time.updated = Date.now();
    Storage.saveSession(this);
  }

  /**
   * Update file change summary.
   */
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
   * Add a system message.
   */
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
}
