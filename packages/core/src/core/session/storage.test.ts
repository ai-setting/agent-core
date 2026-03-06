/**
 * @fileoverview Unit tests for FileStorage
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { FileStorage } from "./storage.js";
import type { SessionInfo, MessageWithParts } from "./types.js";

describe("FileStorage", () => {
  let tempDir: string;
  let storage: FileStorage;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `storage-test-${Date.now()}`);
    storage = new FileStorage(tempDir);
    await storage.ensureInitialized();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("saveSessionInfo / getSessionInfo", () => {
    it("should save and retrieve session info", async () => {
      const info: SessionInfo = {
        id: "test-session-1",
        title: "Test Session",
        directory: "/test/path",
        time: { created: 1000, updated: 2000 },
        metadata: {},
      };

      await storage.saveSessionInfo(info);
      const retrieved = await storage.getSessionInfo("test-session-1");

      expect(retrieved).toEqual(info);
    });

    it("should return undefined for non-existent session", async () => {
      const result = await storage.getSessionInfo("non-existent");
      expect(result).toBeUndefined();
    });

    it("should handle special characters in fields", async () => {
      const info: SessionInfo = {
        id: "test-session-special",
        title: "Test with 'quotes' and \"double quotes\" and \\backslash",
        directory: "D:\\path\\with\\backslash",
        time: { created: 1000, updated: 2000 },
        metadata: { key: "value with 'special' chars" },
      };

      await storage.saveSessionInfo(info);
      const retrieved = await storage.getSessionInfo("test-session-special");

      expect(retrieved).toEqual(info);
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
        parts: [{ id: "prt-1", type: "text", text: "Hello world" }],
      };

      await storage.saveMessage("test-session-1", message);
      const retrieved = await storage.getMessage("test-session-1", "msg-1");

      expect(retrieved).toEqual(message);
    });

    it("should return undefined for non-existent message", async () => {
      const result = await storage.getMessage("test-session-1", "non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("listSessionInfos", () => {
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

      await storage.saveSessionInfo(info1);
      await storage.saveSessionInfo(info2);

      const list = await storage.listSessionInfos();
      expect(list.sessions).toHaveLength(2);
      expect(list.sessions[0].id).toBe("session-2");
      expect(list.sessions[1].id).toBe("session-1");
    });

    it("should skip corrupted session files", async () => {
      await storage.saveSessionInfo({
        id: "valid-session",
        title: "Valid",
        directory: "/path",
        time: { created: 1000, updated: 1000 },
        metadata: {},
      });

      const corruptedPath = path.join(tempDir, "sessions", "corrupted.json");
      await fs.writeFile(corruptedPath, '{ "id": "corrupted", invalid json', "utf-8");

      const list = await storage.listSessionInfos();
      expect(list.sessions).toHaveLength(1);
      expect(list.sessions[0].id).toBe("valid-session");
    });
  });

  describe("atomic write", () => {
    it("should not leave corrupted file on write failure", async () => {
      const info: SessionInfo = {
        id: "test-atomic",
        title: "Test",
        directory: "/path",
        time: { created: 1000, updated: 1000 },
        metadata: {},
      };

      const filePath = path.join(tempDir, "sessions", `${info.id}.json`);

      await storage.saveSessionInfo(info);

      const content = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.id).toBe(info.id);
      expect(parsed.title).toBe(info.title);
    });

    it("should preserve old file if rename fails", async () => {
      const info1: SessionInfo = {
        id: "test-atomic-2",
        title: "Original",
        directory: "/path",
        time: { created: 1000, updated: 1000 },
        metadata: {},
      };

      await storage.saveSessionInfo(info1);
      const originalContent = await fs.readFile(
        path.join(tempDir, "sessions", "test-atomic-2.json"),
        "utf-8"
      );

      const info2: SessionInfo = {
        id: "test-atomic-2",
        title: "Updated",
        directory: "/path",
        time: { created: 1000, updated: 2000 },
        metadata: {},
      };

      await storage.saveSessionInfo(info2);
      const updatedContent = await fs.readFile(
        path.join(tempDir, "sessions", "test-atomic-2.json"),
        "utf-8"
      );

      const parsed = JSON.parse(updatedContent);
      expect(parsed.title).toBe("Updated");
    });

    it("should produce valid JSON (no truncation) when saving large data", async () => {
      const largeInfo: SessionInfo = {
        id: "large-session",
        title: "A".repeat(10000),
        directory: "/path/with/long/directory/path",
        time: { created: 1000, updated: 2000 },
        metadata: {
          data: "x".repeat(50000),
          nested: { deep: "y".repeat(10000) },
          array: Array(100).fill("z".repeat(1000)),
        },
      };

      await storage.saveSessionInfo(largeInfo);

      const filePath = path.join(tempDir, "sessions", "large-session.json");
      const content = await fs.readFile(filePath, "utf-8");

      const parsed = JSON.parse(content);
      expect(parsed.title).toBe(largeInfo.title);
      expect(parsed.metadata!.data).toBe(largeInfo.metadata!.data);
      expect(parsed.metadata!.array).toHaveLength(100);
    });
  });

  describe("deleteSessionInfo", () => {
    it("should delete session info", async () => {
      const info: SessionInfo = {
        id: "to-delete",
        title: "Test",
        directory: "/path",
        time: { created: 1000, updated: 1000 },
        metadata: {},
      };

      await storage.saveSessionInfo(info);
      await storage.deleteSessionInfo("to-delete");

      const result = await storage.getSessionInfo("to-delete");
      expect(result).toBeUndefined();
    });
  });

  describe("deleteMessages", () => {
    it("should delete all messages for a session", async () => {
      const message: MessageWithParts = {
        info: {
          id: "msg-1",
          sessionID: "session-to-delete",
          role: "user",
          timestamp: 1000,
        },
        parts: [{ id: "prt-1", type: "text", text: "Hello" }],
      };

      await storage.saveMessage("session-to-delete", message);
      await storage.deleteMessages("session-to-delete");

      const messages = await storage.getMessages("session-to-delete");
      expect(messages).toHaveLength(0);
    });
  });

  describe("listSessionInfos with filter and pagination", () => {
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

      await storage.saveSessionInfo(info1);
      await storage.saveSessionInfo(info2);

      // Filter: timeRange start=2000
      const result = await storage.listSessionInfos(
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

      await storage.saveSessionInfo(info1);
      await storage.saveSessionInfo(info2);

      // Filter: metadata chat_id = chat1
      const result = await storage.listSessionInfos(
        { metadata: { chat_id: "chat1" } },
        { offset: 0, limit: 10 }
      );

      expect(result.total).toBe(1);
      expect(result.sessions[0].id).toBe("session-chat1");
    });

    it("should apply pagination correctly", async () => {
      for (let i = 0; i < 5; i++) {
        await storage.saveSessionInfo({
          id: `session-${i}`,
          title: `Session ${i}`,
          directory: "/path",
          time: { created: 1000 + i * 1000, updated: 1000 + i * 1000 },
          metadata: {},
        });
      }

      // Pagination: offset=2, limit=2
      const result = await storage.listSessionInfos(
        {},
        { offset: 2, limit: 2 }
      );

      expect(result.total).toBe(5);
      expect(result.sessions).toHaveLength(2);
    });

    it("should return total count regardless of pagination", async () => {
      for (let i = 0; i < 15; i++) {
        await storage.saveSessionInfo({
          id: `session-total-${i}`,
          title: `Session ${i}`,
          directory: "/path",
          time: { created: 1000 + i * 1000, updated: 1000 + i * 1000 },
          metadata: {},
        });
      }

      const result = await storage.listSessionInfos(
        {},
        { offset: 0, limit: 5 }
      );

      expect(result.total).toBe(15);
      expect(result.sessions).toHaveLength(5);
    });
  });
});
