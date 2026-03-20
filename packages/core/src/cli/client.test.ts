/**
 * @fileoverview TongWorkClient Tests
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { TongWorkClient } from "./client.js";

describe("TongWorkClient", () => {
  let client: TongWorkClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    client = new TongWorkClient("http://localhost:4096", { fetch: mockFetch });
  });

  describe("getSession", () => {
    test("should fetch session by id", async () => {
      const mockSession = {
        id: "ses_123",
        title: "Test Session",
        createdAt: "2026-03-20T10:00:00Z",
        updatedAt: "2026-03-20T10:00:00Z",
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockSession),
      });

      const result = await client.getSession("ses_123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4096/sessions/ses_123",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        })
      );
      expect(result).toEqual(mockSession);
    });

    test("should throw error when session not found", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(client.getSession("invalid")).rejects.toThrow("Failed to get session: 404");
    });
  });

  describe("getMessages", () => {
    test("should fetch messages with limit", async () => {
      const mockMessages = [
        { id: "msg_1", role: "user", content: "Hello", timestamp: 1234567890 },
        { id: "msg_2", role: "assistant", content: "Hi", timestamp: 1234567891 },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMessages),
      });

      const result = await client.getMessages("ses_123", { limit: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4096/sessions/ses_123/messages?limit=10",
        expect.any(Object)
      );
      expect(result).toEqual(mockMessages);
    });

    test("should fetch messages with time range", async () => {
      const mockMessages = [
        { id: "msg_1", role: "user", content: "Hello", timestamp: 1234567890 },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMessages),
      });

      const startTime = 1234567000;
      const endTime = 1234570000;

      const result = await client.getMessages("ses_123", {
        startTime,
        endTime,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `http://localhost:4096/sessions/ses_123/messages?startTime=${startTime}&endTime=${endTime}`,
        expect.any(Object)
      );
      expect(result).toEqual(mockMessages);
    });

    test("should fetch messages without params", async () => {
      const mockMessages = [{ id: "msg_1", role: "user", content: "Hello", timestamp: 1234567890 }];

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockMessages),
      });

      const result = await client.getMessages("ses_123");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:4096/sessions/ses_123/messages",
        expect.any(Object)
      );
      expect(result).toEqual(mockMessages);
    });
  });
});
