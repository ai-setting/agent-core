/**
 * @fileoverview Session storage - In-memory storage for sessions and messages.
 *
 * Supports:
 * - Session storage and retrieval
 * - Message storage
 * - Session listing and filtering
 * - Cleanup on deletion
 *
 * Based on OpenCode's Storage architecture (simplified for in-memory use).
 */

import type { SessionInfo, MessageInfo, Part, MessageWithParts } from "./types";
import type { Session } from "./session";

class MemoryStorage {
  private sessions: Map<string, Session> = new Map();
  private sessionInfos: Map<string, SessionInfo> = new Map();
  private messages: Map<string, Map<string, MessageWithParts>> = new Map();

  /**
   * Save a session to storage.
   */
  saveSession(session: Session): void {
    this.sessions.set(session.id, session);
    this.sessionInfos.set(session.id, {
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
    });
  }

  /**
   * Get a session by ID.
   */
  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /**
   * Get session info by ID.
   */
  getSessionInfo(id: string): SessionInfo | undefined {
    return this.sessionInfos.get(id);
  }

  /**
   * Delete a session and all its messages.
   */
  deleteSession(id: string): void {
    this.sessions.delete(id);
    this.sessionInfos.delete(id);
    this.messages.delete(id);
  }

  /**
   * List all sessions.
   */
  listSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * List all session infos.
   */
  listSessionInfos(): SessionInfo[] {
    return Array.from(this.sessionInfos.values());
  }

  /**
   * Get child sessions by parent ID.
   */
  getChildren(parentID: string): SessionInfo[] {
    const result: SessionInfo[] = [];
    for (const info of this.sessionInfos.values()) {
      if (info.parentID === parentID) {
        result.push(info);
      }
    }
    return result;
  }

  /**
   * Save a message for a session.
   */
  saveMessage(sessionID: string, message: MessageWithParts): void {
    if (!this.messages.has(sessionID)) {
      this.messages.set(sessionID, new Map());
    }
    this.messages.get(sessionID)!.set(message.info.id, message);
  }

  /**
   * Get a message by ID.
   */
  getMessage(sessionID: string, messageID: string): MessageWithParts | undefined {
    return this.messages.get(sessionID)?.get(messageID);
  }

  /**
   * Get all messages for a session.
   */
  getMessages(sessionID: string): MessageWithParts[] {
    const sessionMessages = this.messages.get(sessionID);
    if (!sessionMessages) {
      return [];
    }
    return Array.from(sessionMessages.values());
  }

  /**
   * Delete a message.
   */
  deleteMessage(sessionID: string, messageID: string): void {
    this.messages.get(sessionID)?.delete(messageID);
  }

  /**
   * Delete all messages for a session.
   */
  deleteMessages(sessionID: string): void {
    this.messages.delete(sessionID);
  }

  /**
   * Clear all storage.
   */
  clear(): void {
    this.sessions.clear();
    this.sessionInfos.clear();
    this.messages.clear();
  }

  /**
   * Get storage statistics.
   */
  getStats(): {
    sessionCount: number;
    messageCount: number;
  } {
    let messageCount = 0;
    for (const msgs of this.messages.values()) {
      messageCount += msgs.size;
    }
    return {
      sessionCount: this.sessions.size,
      messageCount,
    };
  }
}

// Global storage instance
export const Storage = new MemoryStorage();
