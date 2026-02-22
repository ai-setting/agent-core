/**
 * @fileoverview Session storage - Pluggable storage backend for sessions and messages.
 *
 * Supports:
 * - Memory storage (default, for testing/transient sessions)
 * - File storage (persistent, for production use)
 * - Hybrid mode: sync in-memory cache + async file persistence
 * - Session storage and retrieval
 * - Message storage
 * - Session listing and filtering
 * - Cleanup on deletion
 *
 * Based on OpenCode's Storage architecture with pluggable backend support.
 */

import type { SessionInfo, MessageWithParts } from "./types";
import type { Session } from "./session";
import fs from "fs/promises";
import path from "path";
import { ConfigPaths } from "../../config/paths.js";
import { createLogger } from "../../utils/logger.js";

const storageLogger = createLogger("session:storage", "server.log");

export type StorageMode = "memory" | "file";

export interface PersistenceConfig {
  mode: StorageMode;
  path?: string;
  autoSave: boolean;
}

const DEFAULT_CONFIG: PersistenceConfig = {
  mode: "file",
  autoSave: true,
};

class FileStorage {
  private baseDir: string;
  private sessionsDir: string;
  private messagesDir: string;
  private initialized = false;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? ConfigPaths.storage;
    this.sessionsDir = path.join(this.baseDir, "sessions");
    this.messagesDir = path.join(this.baseDir, "messages");
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
      await fs.mkdir(this.messagesDir, { recursive: true });
      this.initialized = true;
      storageLogger.info(`FileStorage initialized at ${this.baseDir}`);
    } catch (error) {
      storageLogger.error(`Failed to initialize FileStorage: ${error}`);
      throw error;
    }
  }

  private sessionFilePath(sessionID: string): string {
    return path.join(this.sessionsDir, `${sessionID}.json`);
  }

  private messageDirPath(sessionID: string): string {
    return path.join(this.messagesDir, sessionID);
  }

  private messageFilePath(sessionID: string, messageID: string): string {
    return path.join(this.messageDirPath(sessionID), `${messageID}.json`);
  }

  async saveSessionInfo(info: SessionInfo): Promise<void> {
    await this.ensureInitialized();
    const filePath = this.sessionFilePath(info.id);
    await fs.writeFile(filePath, JSON.stringify(info, null, 2));
    storageLogger.debug(`Session info saved to ${filePath}`);
  }

  async getSessionInfo(id: string): Promise<SessionInfo | undefined> {
    await this.ensureInitialized();
    const filePath = this.sessionFilePath(id);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as SessionInfo;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async deleteSessionInfo(id: string): Promise<void> {
    await this.ensureInitialized();
    const filePath = this.sessionFilePath(id);
    await fs.unlink(filePath).catch(() => {});
  }

  async listSessionInfos(): Promise<SessionInfo[]> {
    await this.ensureInitialized();
    const infos: SessionInfo[] = [];

    try {
      const files = await fs.readdir(this.sessionsDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const filePath = path.join(this.sessionsDir, file);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          infos.push(JSON.parse(content) as SessionInfo);
        } catch (error) {
          storageLogger.warn(`Failed to read session file ${file}: ${error}`);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    return infos.sort((a, b) => b.time.updated - a.time.updated);
  }

  async saveMessage(sessionID: string, message: MessageWithParts): Promise<void> {
    await this.ensureInitialized();
    const msgDir = this.messageDirPath(sessionID);
    await fs.mkdir(msgDir, { recursive: true });
    const filePath = this.messageFilePath(sessionID, message.info.id);
    await fs.writeFile(filePath, JSON.stringify(message, null, 2));
    storageLogger.debug(`Message ${message.info.id} saved for session ${sessionID}`);
  }

  async getMessage(sessionID: string, messageID: string): Promise<MessageWithParts | undefined> {
    await this.ensureInitialized();
    const filePath = this.messageFilePath(sessionID, messageID);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content) as MessageWithParts;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async getMessages(sessionID: string): Promise<MessageWithParts[]> {
    await this.ensureInitialized();
    const msgDir = this.messageDirPath(sessionID);
    const messages: MessageWithParts[] = [];

    try {
      const files = await fs.readdir(msgDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const filePath = path.join(msgDir, file);
        try {
          const content = await fs.readFile(filePath, "utf-8");
          messages.push(JSON.parse(content) as MessageWithParts);
        } catch (error) {
          storageLogger.warn(`Failed to read message file ${file}: ${error}`);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    return messages.sort((a, b) => a.info.timestamp - b.info.timestamp);
  }

  async deleteMessage(sessionID: string, messageID: string): Promise<void> {
    await this.ensureInitialized();
    const filePath = this.messageFilePath(sessionID, messageID);
    await fs.unlink(filePath).catch(() => {});
  }

  async deleteMessages(sessionID: string): Promise<void> {
    await this.ensureInitialized();
    const msgDir = this.messageDirPath(sessionID);
    await fs.rm(msgDir, { recursive: true, force: true });
  }

  async clear(): Promise<void> {
    try {
      await fs.rm(this.sessionsDir, { recursive: true, force: true });
      await fs.rm(this.messagesDir, { recursive: true, force: true });
      this.initialized = false;
      await this.ensureInitialized();
    } catch (error) {
      storageLogger.error(`Failed to clear storage: ${error}`);
    }
  }

  async getStats(): Promise<{ sessionCount: number; messageCount: number }> {
    await this.ensureInitialized();
    let sessionCount = 0;
    let messageCount = 0;

    try {
      const sessionFiles = await fs.readdir(this.sessionsDir);
      sessionCount = sessionFiles.filter(f => f.endsWith(".json")).length;

      const sessionDirs = await fs.readdir(this.messagesDir);
      for (const dir of sessionDirs) {
        const msgDir = path.join(this.messagesDir, dir);
        try {
          const files = await fs.readdir(msgDir);
          messageCount += files.filter(f => f.endsWith(".json")).length;
        } catch {}
      }
    } catch {}

    return { sessionCount, messageCount };
  }
}

class StorageImpl {
  private mode: StorageMode = "file";
  private autoSave: boolean = true;
  private fileStorage: FileStorage | null = null;

  private sessions: Map<string, Session> = new Map();
  private sessionInfos: Map<string, SessionInfo> = new Map();
  private messages: Map<string, Map<string, MessageWithParts>> = new Map();
  private initialized = false;
  private pendingOps: Promise<void>[] = [];

  get currentMode(): StorageMode {
    return this.mode;
  }

  async initialize(config?: Partial<PersistenceConfig>): Promise<void> {
    const cfg = { ...DEFAULT_CONFIG, ...config };
    
    const needsReinit = !this.initialized || 
                        this.mode !== cfg.mode || 
                        (cfg.path && this.fileStorage);

    if (!needsReinit) {
      return;
    }

    this.mode = cfg.mode;
    this.autoSave = cfg.autoSave;

    if (this.mode === "file") {
      this.fileStorage = new FileStorage(cfg.path);
      await this.fileStorage.ensureInitialized();

      const savedInfos = await this.fileStorage.listSessionInfos();
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

        const savedMessages = await this.fileStorage.getMessages(info.id);
        if (savedMessages.length > 0) {
          const msgMap = new Map<string, MessageWithParts>();
          for (const msg of savedMessages) {
            msgMap.set(msg.info.id, msg);
          }
          this.messages.set(info.id, msgMap);
        }
      }
      storageLogger.info(`Loaded ${savedInfos.length} sessions from file storage`);
    } else {
      this.fileStorage = null;
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

    if (this.autoSave && this.fileStorage) {
      const op = this.fileStorage.saveSessionInfo(info).catch(err => {
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

    if (this.autoSave && this.fileStorage) {
      const op1 = this.fileStorage.deleteSessionInfo(id).catch(err => {
        storageLogger.error(`Failed to delete session ${id}: ${err}`);
      });
      const op2 = this.fileStorage.deleteMessages(id).catch(err => {
        storageLogger.error(`Failed to delete messages for session ${id}: ${err}`);
      });
      this.pendingOps.push(op1, op2);
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

    if (this.autoSave && this.fileStorage) {
      const op = this.fileStorage.saveMessage(sessionID, message).catch(err => {
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
    return Array.from(sessionMessages.values()).sort((a, b) => a.info.timestamp - b.info.timestamp);
  }

  deleteMessage(sessionID: string, messageID: string): void {
    this.messages.get(sessionID)?.delete(messageID);

    if (this.autoSave && this.fileStorage) {
      const op = this.fileStorage.deleteMessage(sessionID, messageID).catch(err => {
        storageLogger.error(`Failed to delete message ${messageID}: ${err}`);
      });
      this.pendingOps.push(op);
    }
  }

  deleteMessages(sessionID: string): void {
    this.messages.delete(sessionID);

    if (this.autoSave && this.fileStorage) {
      const op = this.fileStorage.deleteMessages(sessionID).catch(err => {
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

    if (this.fileStorage) {
      this.fileStorage.clear().catch(err => {
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

    if (this.fileStorage) {
      await this.fileStorage.clear();
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
    
    if (this.fileStorage) {
      await this.fileStorage.ensureInitialized();
    }
  }
}

export const Storage = new StorageImpl();
