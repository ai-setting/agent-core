/**
 * @fileoverview EventMcpClient 单元测试
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "bun:test";
import { EventMcpClient } from "./client.js";
import { EventSourceStatus } from "./types.js";

describe("EventMcpClient", () => {
  let mockEnv: any;
  let client: EventMcpClient;

  beforeEach(() => {
    mockEnv = {
      publishEvent: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    test("should create client with initial state", () => {
      const config = {
        type: "local" as const,
        command: ["bun", "run", "timer.mjs"],
      };

      client = new EventMcpClient(mockEnv, "timer", config);

      expect(client.getName()).toBe("timer");
      expect(client.getStatus()).toBe(EventSourceStatus.STOPPED);
      expect(client.getEventCount()).toBe(0);
    });

    test("should accept options parameter", () => {
      const config = {
        type: "local" as const,
        command: ["bun", "run", "timer.mjs"],
      };

      const options = {
        eventTypes: ["timer.heartbeat"],
        pollInterval: 5000,
      };

      client = new EventMcpClient(mockEnv, "timer", config, options);

      expect(client.getName()).toBe("timer");
    });
  });

  describe("getStatus", () => {
    test("should return STOPPED initially", () => {
      const config = {
        type: "local" as const,
        command: ["bun", "run", "timer.mjs"],
      };

      client = new EventMcpClient(mockEnv, "timer", config);

      expect(client.getStatus()).toBe(EventSourceStatus.STOPPED);
    });
  });

  describe("getName", () => {
    test("should return the client name", () => {
      const config = {
        type: "local" as const,
        command: ["bun", "run", "timer.mjs"],
      };

      client = new EventMcpClient(mockEnv, "my-timer", config);

      expect(client.getName()).toBe("my-timer");
    });
  });

  describe("getEventCount", () => {
    test("should return 0 initially", () => {
      const config = {
        type: "local" as const,
        command: ["bun", "run", "timer.mjs"],
      };

      client = new EventMcpClient(mockEnv, "timer", config);

      expect(client.getEventCount()).toBe(0);
    });
  });

  describe("local vs remote config", () => {
    test("should accept local config", () => {
      const config = {
        type: "local" as const,
        command: ["bun", "run", "timer.mjs"],
        environment: { NODE_ENV: "test" },
      };

      client = new EventMcpClient(mockEnv, "timer", config);

      expect(client.getName()).toBe("timer");
    });

    test("should accept remote config", () => {
      const config = {
        type: "remote" as const,
        url: "https://events.example.com/mcp",
        headers: {
          Authorization: "Bearer token",
        },
      };

      client = new EventMcpClient(mockEnv, "webhook", config);

      expect(client.getName()).toBe("webhook");
    });
  });
});
