import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";
import { ConfigPaths } from "../../../config/paths.js";
import type { SessionPersistence, PersistenceConfig } from "../persistence.js";
import type { SessionInfo, MessageWithParts, Part, SessionFilter, ListOptions } from "../types.js";
import { createLogger } from "../../../utils/logger.js";

const sqliteLogger = createLogger("session:sqlite", "server.log");

export class SqlitePersistence implements SessionPersistence {
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? path.join(ConfigPaths.storage, "sessions.db");
  }

  async initialize(config?: Partial<PersistenceConfig>): Promise<void> {
    if (this.initialized) return;

    try {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.db = new Database(this.dbPath);
      this.db.run("PRAGMA journal_mode = WAL");
      await this.migrate();
      this.initialized = true;
      sqliteLogger.info(`SQLite persistence initialized at ${this.dbPath}`);
    } catch (error) {
      sqliteLogger.error(`Failed to initialize SQLite: ${error}`);
      throw error;
    }
  }

  private async migrate(): Promise<void> {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS session (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        title TEXT NOT NULL,
        directory TEXT NOT NULL,
        summary_additions INTEGER,
        summary_deletions INTEGER,
        summary_files INTEGER,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        message_count INTEGER DEFAULT 0,
        metadata TEXT
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_session_parent ON session(parent_id)`);
    
    // Try to add message_count column (will fail if already exists, which is fine)
    try {
      this.db.run(`ALTER TABLE session ADD COLUMN message_count INTEGER DEFAULT 0`);
    } catch (e) {
      // Column already exists, ignore error
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_id TEXT,
        role TEXT NOT NULL,
        agent TEXT,
        model TEXT,
        timestamp INTEGER NOT NULL,
        metadata TEXT
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_message_session ON message(session_id)`);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS part (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_part_message ON part(message_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_part_session ON part(session_id)`);
  }

  async saveSession(info: SessionInfo): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const messageCount = info.messageCount ?? 0;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO session (id, parent_id, title, directory, summary_additions, summary_deletions, summary_files, time_created, time_updated, message_count, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      info.id,
      info.parentID ?? null,
      info.title,
      info.directory,
      info.summary?.additions ?? null,
      info.summary?.deletions ?? null,
      info.summary?.files ?? null,
      info.time.created,
      info.time.updated,
      messageCount,
      info.metadata ? JSON.stringify(info.metadata) : null
    );

    // [DEBUG] Log after saving session to SQLite
    sqliteLogger.info(`[SQLite] saveSession: id=${info.id}, messageCount=${messageCount}, timeUpdated=${info.time.updated}`);
  }

  async updateMessageCount(sessionId: string, count: number): Promise<void> {
    if (!this.db) throw new Error("Not initialized");
    const stmt = this.db.prepare(`UPDATE session SET message_count = ? WHERE id = ?`);
    stmt.run(count, sessionId);
  }

  async getSession(id: string): Promise<SessionInfo | undefined> {
    if (!this.db) throw new Error("Not initialized");

    const stmt = this.db.prepare("SELECT * FROM session WHERE id = ?");
    const row = stmt.get(id) as any;

    if (!row) return undefined;

    return {
      id: row.id,
      parentID: row.parent_id,
      title: row.title,
      directory: row.directory,
      summary: row.summary_additions
        ? {
            additions: row.summary_additions,
            deletions: row.summary_deletions,
            files: row.summary_files,
          }
        : undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
      metadata: row.metadata,
    };
  }

  async deleteSession(id: string): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    this.db.prepare("DELETE FROM part WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM message WHERE session_id = ?").run(id);
    this.db.prepare("DELETE FROM session WHERE id = ?").run(id);
  }

  async listSessions(
    filter?: SessionFilter,
    options?: ListOptions
  ): Promise<{ total: number; sessions: SessionInfo[] }> {
    if (!this.db) throw new Error("Not initialized");

    let whereClause = "";
    const params: any[] = [];

    if (filter) {
      const conditions: string[] = [];

      // Time range filter
      if (filter.timeRange) {
        if (filter.timeRange.start !== undefined) {
          conditions.push("time_created >= ?");
          params.push(filter.timeRange.start);
        }
        if (filter.timeRange.end !== undefined) {
          conditions.push("time_created <= ?");
          params.push(filter.timeRange.end);
        }
      }

      // Metadata filter
      if (filter.metadata) {
        for (const [key, value] of Object.entries(filter.metadata)) {
          conditions.push("json_extract(metadata, ?) = ?");
          params.push(`$.${key}`, value);
        }
      }

      if (conditions.length > 0) {
        whereClause = "WHERE " + conditions.join(" AND ");
      }
    }

    // Get total count
    const countSql = `SELECT COUNT(*) as count FROM session ${whereClause}`;
    const countStmt = this.db.prepare(countSql);
    const countResult = countStmt.get(...params) as { count: number };
    const total = countResult.count;

    // Get paginated results
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 20;
    const sql = `SELECT * FROM session ${whereClause} ORDER BY time_updated DESC LIMIT ? OFFSET ?`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params, limit, offset) as any[];

    sqliteLogger.info(`[SQLite] listSessions: loaded ${rows.length} sessions, total=${total}`);

    const sessions = rows.map((row) => ({
      id: row.id,
      parentID: row.parent_id,
      title: row.title,
      directory: row.directory,
      messageCount: row.message_count ?? 0,
      summary: row.summary_additions
        ? {
            additions: row.summary_additions,
            deletions: row.summary_deletions,
            files: row.summary_files,
          }
        : undefined,
      time: {
        created: row.time_created,
        updated: row.time_updated,
      },
      metadata: row.metadata,
    }));

    return { total, sessions };
  }

  async findSessionIdsByMetadata(metadata: Record<string, unknown>): Promise<string[]> {
    if (!this.db) throw new Error("Not initialized");

    if (!metadata || Object.keys(metadata).length === 0) {
      return [];
    }

    const conditions: string[] = [];
    const params: any[] = [];

    for (const [key, value] of Object.entries(metadata)) {
      conditions.push("json_extract(metadata, ?) = ?");
      params.push(`$.${key}`, value);
    }

    const sql = `SELECT id FROM session WHERE metadata IS NOT NULL AND (${conditions.join(" AND ")}) ORDER BY time_created DESC`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as { id: string }[];

    sqliteLogger.info(`[SQLite] findSessionIdsByMetadata: found ${rows.length} sessions for metadata: ${JSON.stringify(metadata)}`);

    return rows.map((row) => row.id);
  }

  async getSessionMessages(
    sessionId: string,
    options?: ListOptions
  ): Promise<{ total: number; messages: Array<{ id: string; role: string; timestamp: number }> }> {
    if (!this.db) throw new Error("Not initialized");

    // Get total count
    const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM message WHERE session_id = ?");
    const countResult = countStmt.get(sessionId) as { count: number };
    const total = countResult.count;

    // Get paginated messages
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 20;
    const stmt = this.db.prepare(
      "SELECT id, role, timestamp FROM message WHERE session_id = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?"
    );
    const rows = stmt.all(sessionId, limit, offset) as Array<{ id: string; role: string; timestamp: number }>;

    sqliteLogger.info(`[SQLite] getSessionMessages: loaded ${rows.length} messages, total=${total}`);

    return { total, messages: rows };
  }

  async saveMessage(sessionID: string, message: MessageWithParts): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const insertMessage = this.db.prepare(`
      INSERT OR REPLACE INTO message (id, session_id, parent_id, role, agent, model, timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertMessage.run(
      message.info.id,
      sessionID,
      message.info.parentID ?? null,
      message.info.role,
      message.info.agent ?? null,
      message.info.model ?? null,
      message.info.timestamp,
      message.info.metadata ? JSON.stringify(message.info.metadata) : null
    );

    const insertPart = this.db.prepare(`
      INSERT OR REPLACE INTO part (id, message_id, session_id, type, data, time_created, time_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const part of message.parts) {
      const partTime = "time" in part ? (part as any).time : undefined;
      insertPart.run(
        part.id,
        message.info.id,
        sessionID,
        part.type,
        JSON.stringify(part),
        partTime?.start ?? Date.now(),
        partTime?.end ?? Date.now()
      );
    }

    // [DEBUG] Log after saving message to SQLite
    sqliteLogger.info(`[SQLite] saveMessage: sessionId=${sessionID}, messageId=${message.info.id}, role=${message.info.role}, partsCount=${message.parts.length}, timestamp=${message.info.timestamp}`);
  }

  async getMessage(sessionID: string, messageID: string): Promise<MessageWithParts | undefined> {
    if (!this.db) throw new Error("Not initialized");

    const msgStmt = this.db.prepare("SELECT * FROM message WHERE id = ? AND session_id = ?");
    const messageRow = msgStmt.get(messageID, sessionID) as any;

    if (!messageRow) return undefined;

    const partStmt = this.db.prepare("SELECT * FROM part WHERE message_id = ?");
    const partRows = partStmt.all(messageID) as any[];

    return {
      info: {
        id: messageRow.id,
        sessionID: messageRow.session_id,
        parentID: messageRow.parent_id,
        role: messageRow.role,
        agent: messageRow.agent,
        model: messageRow.model,
        timestamp: messageRow.timestamp,
        metadata: messageRow.metadata,
      },
      parts: partRows.map((p) => JSON.parse(p.data) as Part),
    };
  }

  async getMessages(sessionID: string): Promise<MessageWithParts[]> {
    if (!this.db) throw new Error("Not initialized");

    const msgStmt = this.db.prepare("SELECT * FROM message WHERE session_id = ? ORDER BY timestamp");
    const messageRows = msgStmt.all(sessionID) as any[];

    // [DEBUG] Log messages loaded from SQLite
    sqliteLogger.info(`[SQLite] getMessages: sessionId=${sessionID}, loaded ${messageRows.length} messages`);

    const result: MessageWithParts[] = [];
    for (const msgRow of messageRows) {
      const partStmt = this.db.prepare("SELECT * FROM part WHERE message_id = ?");
      const partRows = partStmt.all(msgRow.id) as any[];

      result.push({
        info: {
          id: msgRow.id,
          sessionID: msgRow.session_id,
          parentID: msgRow.parent_id,
          role: msgRow.role,
          agent: msgRow.agent,
          model: msgRow.model,
          timestamp: msgRow.timestamp,
          metadata: msgRow.metadata,
        },
        parts: partRows.map((p) => JSON.parse(p.data) as Part),
      });
    }

    return result;
  }

  async deleteMessage(sessionID: string, messageID: string): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    this.db.prepare("DELETE FROM part WHERE message_id = ? AND session_id = ?").run(messageID, sessionID);
    this.db.prepare("DELETE FROM message WHERE id = ? AND session_id = ?").run(messageID, sessionID);
  }

  async deleteMessages(sessionID: string): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    this.db.prepare("DELETE FROM part WHERE session_id = ?").run(sessionID);
    this.db.prepare("DELETE FROM message WHERE session_id = ?").run(sessionID);
  }

  async clear(): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    this.db.run("DELETE FROM part");
    this.db.run("DELETE FROM message");
    this.db.run("DELETE FROM session");
  }

  async flush(): Promise<void> {
    // SQLite auto-commits, no action needed
  }
}
