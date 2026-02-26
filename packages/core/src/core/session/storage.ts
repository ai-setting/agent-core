/**
 * @fileoverview Session storage - Pluggable storage backend for sessions and messages.
 *
 * Supports:
 * - Memory storage (default, for testing/transient sessions)
 * - SQLite storage (persistent, for production use)
 * - Hybrid mode: sync in-memory cache + async persistence
 * - Session storage and retrieval
 * - Message storage
 * - Session listing and filtering
 * - Cleanup on deletion
 *
 * Based on OpenCode's Storage architecture with pluggable backend support.
 */

import type { SessionInfo, MessageWithParts } from "./types";
import type { Session } from "./session";
import type { SessionPersistence, PersistenceConfig } from "./persistence.js";
import { SqlitePersistence } from "./sqlite/index.js";
import { createLogger } from "../../utils/logger.js";

const storageLogger = createLogger("session:storage", "server.log");

const DEFAULT_CONFIG: PersistenceConfig = {
  mode: "sqlite",
  autoSave: true,
};

class StorageImpl {
  private mode: "memory" | "sqlite" = "sqlite";
  private autoSave: boolean = true;
  private persistence: SessionPersistence | null = null;

  private sessions: Map<string, Session> = new Map();
  private sessionInfos: Map<string, SessionInfo> = new Map();
  private messages: Map<string, Map<string, MessageWithParts>> = new Map();
  private initialized = false;
  private pendingOps: Promise<void>[] = [];

  get currentMode(): "memory" | "sqlite" {
    return this.mode;
  }

  async initialize(config?: Partial<PersistenceConfig>): Promise<void> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    const needsReinit =
      !this.initialized || this.mode !== cfg.mode || (cfg.path && this.persistence);

    if (!needsReinit) {
      return;
    }

    this.mode = cfg.mode;
    this.autoSave = cfg.autoSave;

    if (this.mode === "sqlite") {
      this.persistence = new SqlitePersistence(cfg.path);
      await this.persistence.initialize(cfg);

      const savedInfos = await this.persistence.listSessions();
      for (const info of savedInfos) {
        this.sessionInfos.set(info.id, info);

        const { Session: SessionClass } = await import("./session.js");
        const session = SessionClass.create({
          id: info.id,
          parentID: info.parentID,
          title: info.title,
          directory: info.directory,
          metadata: info.metadata,
        });
        this.sessions.set(info.id, session);

        const savedMessages = await this.persistence.getMessages(info.id);
        if (savedMessages.length > 0) {
          const msgMap = new Map<string, MessageWithParts>();
          for (const msg of savedMessages) {
            session.addMessage(msg.info, msg.parts);
            msgMap.set(msg.info.id, msg);
          }
          this.messages.set(info.id, msgMap);
        }
      }
      storageLogger.info(`Loaded ${savedInfos.length} sessions from SQLite storage`);
    } else {
      this.persistence = null;
    }

    this.initialized = true;
  }

  saveSession(session: Session): void {
    const info: SessionInfo = {
      id: session.id,
      parentID: session.parentID,
      title: session.title,
      directory: session.directory,
      summary: session.summary,
      time: {
        created: session.createdAt,
        updated: session.updatedAt,
      },
      metadata: session.metadata,
    };

    this.sessions.set(session.id, session);
    this.sessionInfos.set(session.id, info);

    if (this.autoSave && this.persistence) {
      const op = this.persistence.saveSession(info).catch((err) => {
        storageLogger.error(`Failed to save session ${session.id}: ${err}`);
      });
      this.pendingOps.push(op);
    }
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getSessionInfo(id: string): SessionInfo | undefined {
    return this.sessionInfos.get(id);
  }

  deleteSession(id: string): void {
    const children = this.getChildren(id);
    for (const childInfo of children) {
      const child = this.sessions.get(childInfo.id);
      if (child) {
        this.deleteSession(childInfo.id);
      }
    }

    this.sessions.delete(id);
    this.sessionInfos.delete(id);
    this.messages.delete(id);

    if (this.autoSave && this.persistence) {
      const op1 = this.persistence.deleteSession(id).catch((err) => {
        storageLogger.error(`Failed to delete session ${id}: ${err}`);
      });
      this.pendingOps.push(op1);
    }
  }

  listSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  listSessionInfos(): SessionInfo[] {
    return Array.from(this.sessionInfos.values());
  }

  getChildren(parentID: string): SessionInfo[] {
    const result: SessionInfo[] = [];
    for (const info of this.sessionInfos.values()) {
      if (info.parentID === parentID) {
        result.push(info);
      }
    }
    return result;
  }

  saveMessage(sessionID: string, message: MessageWithParts): void {
    if (!this.messages.has(sessionID)) {
      this.messages.set(sessionID, new Map());
    }
    this.messages.get(sessionID)!.set(message.info.id, message);

    if (this.autoSave && this.persistence) {
      const op = this.persistence.saveMessage(sessionID, message).catch((err) => {
        storageLogger.error(`Failed to save message ${message.info.id}: ${err}`);
      });
      this.pendingOps.push(op);
    }
  }

  getMessage(sessionID: string, messageID: string): MessageWithParts | undefined {
    return this.messages.get(sessionID)?.get(messageID);
  }

  getMessages(sessionID: string): MessageWithParts[] {
    const sessionMessages = this.messages.get(sessionID);
    if (!sessionMessages) {
      return [];
    }
    return Array.from(sessionMessages.values()).sort(
      (a, b) => a.info.timestamp - b.info.timestamp
    );
  }

  deleteMessage(sessionID: string, messageID: string): void {
    this.messages.get(sessionID)?.delete(messageID);

    if (this.autoSave && this.persistence) {
      const op = this.persistence.deleteMessage(sessionID, messageID).catch((err) => {
        storageLogger.error(`Failed to delete message ${messageID}: ${err}`);
      });
      this.pendingOps.push(op);
    }
  }

  deleteMessages(sessionID: string): void {
    this.messages.delete(sessionID);

    if (this.autoSave && this.persistence) {
      const op = this.persistence.deleteMessages(sessionID).catch((err) => {
        storageLogger.error(`Failed to delete messages for session ${sessionID}: ${err}`);
      });
      this.pendingOps.push(op);
    }
  }

  clear(): void {
    this.sessions.clear();
    this.sessionInfos.clear();
    this.messages.clear();
    this.initialized = false;
    this.pendingOps = [];

    if (this.persistence) {
      this.persistence.clear().catch((err) => {
        storageLogger.error(`Failed to clear storage: ${err}`);
      });
    }
  }

  clearMemory(): void {
    this.sessions.clear();
    this.sessionInfos.clear();
    this.messages.clear();
    this.initialized = false;
    this.pendingOps = [];
  }

  async clearAsync(): Promise<void> {
    this.sessions.clear();
    this.sessionInfos.clear();
    this.messages.clear();
    this.initialized = false;
    this.pendingOps = [];

    if (this.persistence) {
      await this.persistence.clear();
    }
  }

  getStats(): { sessionCount: number; messageCount: number } {
    let messageCount = 0;
    for (const msgs of this.messages.values()) {
      messageCount += msgs.size;
    }
    return {
      sessionCount: this.sessions.size,
      messageCount,
    };
  }

  async flush(): Promise<void> {
    const ops = this.pendingOps;
    this.pendingOps = [];
    await Promise.all(ops);

    if (this.persistence) {
      await this.persistence.flush();
    }
  }
}

const Storage = new StorageImpl();

export { Storage };
export type { SessionPersistence, PersistenceConfig };
