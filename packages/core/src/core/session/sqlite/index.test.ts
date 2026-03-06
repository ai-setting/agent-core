/**
 * @fileoverview Unit tests for SqlitePersistence
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import os from "os";
import { SqlitePersistence } from "./index.js";
import type { SessionInfo, MessageWithParts } from "../types.js";

describe("SqlitePersistence", () => {
  let tempDir: string;
  let storage: SqlitePersistence;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `sqlite-test-${Date.now()}`);
    storage = new SqlitePersistence(tempDir);
    await storage.initialize();
  });

  afterEach(async () => {
    await storage.clear();
  });

  describe("saveSession / getSession", () => {
    it("should save and retrieve session info", async () => {
      const info: SessionInfo = {
        id: "test-session-1",
        title: "Test Session",
        directory: "/test/path",
        time: { created: 1000, updated: 2000 },
        metadata: { key: "value" },
      };

      await storage.saveSession(info);
      const retrieved = await storage.getSession("test-session-1");

      expect(retrieved?.id).toBe("test-session-1");
      expect(retrieved?.title).toBe("Test Session");
      expect(retrieved?.directory).toBe("/test/path");
    });

    it("should return undefined for non-existent session", async () => {
      const result = await storage.getSession("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("deleteSession", () => {
    it("should delete session", async () => {
      const info: SessionInfo = {
        id: "session-to-delete",
        title: "To Delete",
        directory: "/path",
        time: { created: 1000, updated: 1000 },
        metadata: {},
      };

      await storage.saveSession(info);
      await storage.deleteSession("session-to-delete");

      const result = await storage.getSession("session-to-delete");
      expect(result).toBeUndefined();
    });
  });

  describe("listSessions with filter and pagination", () => {
    it("should list all sessions sorted by updated time", async () => {
      const info1: SessionInfo = {
        id: "session-1",
        title: "First",
        directory: "/path1",
        time: { created: 1000, updated: 1000 },
        metadata: {},
      };
      const info2: SessionInfo = {
        id: "session-2",
        title: "Second",
        directory: "/path2",
        time: { created: 2000, updated: 3000 },
        metadata: {},
      };

      await storage.saveSession(info1);
      await storage.saveSession(info2);

      const result = await storage.listSessions();
      expect(result.total).toBe(2);
      expect(result.sessions[0].id).toBe("session-2");
      expect(result.sessions[1].id).toBe("session-1");
    });

    it("should filter by time range", async () => {
      const info1: SessionInfo = {
        id: "session-old",
        title: "Old Session",
        directory: "/path1",
        time: { created: 1000, updated: 1000 },
        metadata: {},
      };
      const info2: SessionInfo = {
        id: "session-new",
        title: "New Session",
        directory: "/path2",
        time: { created: 3000, updated: 3000 },
        metadata: {},
      };

      await storage.saveSession(info1);
      await storage.saveSession(info2);

      // Filter: timeRange start=2000
      const result = await storage.listSessions(
        { timeRange: { start: 2000 } },
        { offset: 0, limit: 10 }
      );

      expect(result.total).toBe(1);
      expect(result.sessions[0].id).toBe("session-new");
    });

    it("should filter by metadata", async () => {
      const info1: SessionInfo = {
        id: "session-chat1",
        title: "Chat 1",
        directory: "/path1",
        time: { created: 1000, updated: 1000 },
        metadata: { chat_id: "chat1", trigger_type: "event" },
      };
      const info2: SessionInfo = {
        id: "session-chat2",
        title: "Chat 2",
        directory: "/path2",
        time: { created: 2000, updated: 2000 },
        metadata: { chat_id: "chat2", trigger_type: "user_prompt" },
      };

      await storage.saveSession(info1);
      await storage.saveSession(info2);

      // Filter: metadata chat_id = chat1
      const result = await storage.listSessions(
        { metadata: { chat_id: "chat1" } },
        { offset: 0, limit: 10 }
      );

      expect(result.total).toBe(1);
      expect(result.sessions[0].id).toBe("session-chat1");
    });

    it("should apply pagination correctly", async () => {
      for (let i = 0; i < 5; i++) {
        await storage.saveSession({
          id: `session-${i}`,
          title: `Session ${i}`,
          directory: "/path",
          time: { created: 1000 + i * 1000, updated: 1000 + i * 1000 },
          metadata: {},
        });
      }

      // Pagination: offset=2, limit=2
      const result = await storage.listSessions(
        {},
        { offset: 2, limit: 2 }
      );

      expect(result.total).toBe(5);
      expect(result.sessions).toHaveLength(2);
    });

    it("should return total count regardless of pagination", async () => {
      for (let i = 0; i < 15; i++) {
        await storage.saveSession({
          id: `session-total-${i}`,
          title: `Session ${i}`,
          directory: "/path",
          time: { created: 1000 + i * 1000, updated: 1000 + i * 1000 },
          metadata: {},
        });
      }

      const result = await storage.listSessions(
        {},
        { offset: 0, limit: 5 }
      );

      expect(result.total).toBe(15);
      expect(result.sessions).toHaveLength(5);
    });
  });

  describe("findSessionIdsByMetadata", () => {
    it("should find sessions by single metadata key", async () => {
      const info1: SessionInfo = {
        id: "session-a",
        title: "Session A",
        directory: "/path",
        time: { created: 1000, updated: 1000 },
        metadata: { chat_id: "chat1" },
      };
      const info2: SessionInfo = {
        id: "session-b",
        title: "Session B",
        directory: "/path",
        time: { created: 2000, updated: 2000 },
        metadata: { chat_id: "chat2" },
      };

      await storage.saveSession(info1);
      await storage.saveSession(info2);

      const result = await storage.findSessionIdsByMetadata({ chat_id: "chat1" });

      expect(result).toContain("session-a");
      expect(result).not.toContain("session-b");
    });

    it("should find sessions by multiple metadata keys", async () => {
      const info1: SessionInfo = {
        id: "session-multi",
        title: "Multi Match",
        directory: "/path",
        time: { created: 1000, updated: 1000 },
        metadata: { chat_id: "chat1", trigger_type: "event" },
      };
      const info2: SessionInfo = {
        id: "session-partial",
        title: "Partial Match",
        directory: "/path",
        time: { created: 2000, updated: 2000 },
        metadata: { chat_id: "chat1", trigger_type: "user_prompt" },
      };

      await storage.saveSession(info1);
      await storage.saveSession(info2);

      const result = await storage.findSessionIdsByMetadata({ chat_id: "chat1", trigger_type: "event" });

      expect(result).toContain("session-multi");
      expect(result).not.toContain("session-partial");
    });

    it("should return empty for non-matching metadata", async () => {
      const info: SessionInfo = {
        id: "session-x",
        title: "Session X",
        directory: "/path",
        time: { created: 1000, updated: 1000 },
        metadata: { chat_id: "chat1" },
      };

      await storage.saveSession(info);

      const result = await storage.findSessionIdsByMetadata({ chat_id: "nonexistent" });

      expect(result).toHaveLength(0);
    });
  });

  describe("getSessionMessages", () => {
    it("should save and retrieve messages", async () => {
      const sessionId = "test-session-msgs";
      const message: MessageWithParts = {
        info: {
          id: "msg-1",
          sessionID: sessionId,
          role: "user",
          timestamp: 1000,
        },
        parts: [{ id: "part-1", type: "text", text: "Hello" }],
      };

      await storage.saveMessage(sessionId, message);
      const messages = await storage.getMessages(sessionId);

      expect(messages).toHaveLength(1);
      expect(messages[0].info.id).toBe("msg-1");
    });

    it("should return paginated messages", async () => {
      const sessionId = "session-msgs";
      
      for (let i = 0; i < 10; i++) {
        await storage.saveMessage(sessionId, {
          info: {
            id: `msg-${i}`,
            sessionID: sessionId,
            role: "user",
            timestamp: 1000 + i * 1000,
          },
          parts: [{ id: `part-${i}`, type: "text", text: `Message ${i}` }],
        });
      }

      const result = await storage.getSessionMessages(sessionId, { offset: 2, limit: 3 });

      expect(result.total).toBe(10);
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].id).toBe("msg-2");
    });

    it("should return empty for non-existent session", async () => {
      const result = await storage.getSessionMessages("nonexistent", { offset: 0, limit: 10 });

      expect(result.total).toBe(0);
      expect(result.messages).toHaveLength(0);
    });
  });
});
