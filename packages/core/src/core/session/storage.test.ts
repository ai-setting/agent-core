/**
 * @fileoverview Unit tests for SessionPersistence (SQLite implementation)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import os from "os";
import path from "path";
import { SqlitePersistence } from "./sqlite/index.js";
import type { SessionInfo, MessageWithParts } from "./types.js";

describe("SqlitePersistence", () => {
  let tempDir: string;
  let storage: SqlitePersistence;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `sqlite-test-${Date.now()}`);
    storage = new SqlitePersistence(path.join(tempDir, "test.db"));
    await storage.initialize({});
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
      };

      await storage.saveSession(info);
      const retrieved = await storage.getSession("test-session-1");

      expect(retrieved?.id).toBe(info.id);
      expect(retrieved?.title).toBe(info.title);
      expect(retrieved?.directory).toBe(info.directory);
    });

    it("should return undefined for non-existent session", async () => {
      const result = await storage.getSession("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("saveMessage / getMessage", () => {
    it("should save and retrieve message", async () => {
      const message: MessageWithParts = {
        info: {
          id: "msg-1",
          sessionID: "test-session-1",
          role: "user",
          timestamp: 1000,
        },
        parts: [{ id: "prt-1", type: "text", text: "Hello world" } as any],
      };

      await storage.saveMessage("test-session-1", message);
      const retrieved = await storage.getMessage("test-session-1", "msg-1");

      expect(retrieved?.info.id).toBe(message.info.id);
      expect((retrieved?.parts[0] as any).text).toBe("Hello world");
    });
  });

  describe("listSessions", () => {
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

      const list = await storage.listSessions();
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe("session-2");
      expect(list[1].id).toBe("session-1");
    });
  });

  describe("deleteSession", () => {
    it("should delete session and its messages", async () => {
      const info: SessionInfo = {
        id: "to-delete",
        title: "Test",
        directory: "/path",
        time: { created: 1000, updated: 1000 },
        metadata: {},
      };

      const message: MessageWithParts = {
        info: { id: "msg-1", sessionID: "to-delete", role: "user", timestamp: 1000 },
        parts: [{ id: "prt-1", type: "text", text: "Hello" } as any],
      };

      await storage.saveSession(info);
      await storage.saveMessage("to-delete", message);
      await storage.deleteSession("to-delete");

      const result = await storage.getSession("to-delete");
      expect(result).toBeUndefined();

      const messages = await storage.getMessages("to-delete");
      expect(messages).toHaveLength(0);
    });
  });
});
