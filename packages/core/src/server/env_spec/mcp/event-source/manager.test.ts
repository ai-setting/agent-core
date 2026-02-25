/**
 * @fileoverview EventMcpManager 单元测试
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "bun:test";
import { EventMcpManager } from "./manager.js";
import { EventSourceStatus } from "./types.js";

vi.mock("./client.js", () => ({
  EventMcpClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue(EventSourceStatus.RUNNING),
    getName: vi.fn().mockImplementation(function(this: any) { return this._name; }),
    getEventCount: vi.fn().mockReturnValue(0),
  })),
}));

describe("EventMcpManager", () => {
  let manager: EventMcpManager;
  let mockEnv: any;

  beforeEach(() => {
    mockEnv = {
      publishEvent: vi.fn().mockResolvedValue(undefined),
    };
    manager = new EventMcpManager(mockEnv);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    test("should create manager with empty state", () => {
      expect(manager.getClients().size).toBe(0);
      expect(manager.getEventSourceNames().length).toBe(0);
    });
  });

  describe("loadClients", () => {
    test("should load clients from mcp config", async () => {
      const mcpClientsConfig = {
        timer: {
          type: "local" as const,
          command: ["bun", "run", "timer.mjs"],
        },
      };

      await manager.loadClients(mcpClientsConfig, undefined);

      expect(manager.getEventSourceNames()).toContain("timer");
    });

    test("should skip disabled clients", async () => {
      const mcpClientsConfig = {
        timer: {
          type: "local" as const,
          command: ["bun", "run", "timer.mjs"],
        },
      };

      const eventSourceConfig = {
        timer: {
          name: "timer",
          client: mcpClientsConfig.timer,
          enabled: false,
        },
      };

      await manager.loadClients(mcpClientsConfig, eventSourceConfig);

      expect(manager.getEventSourceNames()).not.toContain("timer");
    });

    test("should use eventSourceConfig when provided", async () => {
      const mcpClientsConfig = {
        timer: {
          type: "local" as const,
          command: ["bun", "run", "timer.mjs"],
        },
        webhook: {
          type: "remote" as const,
          url: "https://events.example.com/mcp",
        },
      };

      const eventSourceConfig = {
        timer: {
          name: "timer",
          client: mcpClientsConfig.timer,
          enabled: true,
          options: {
            eventTypes: ["timer.heartbeat"],
          },
        },
      };

      await manager.loadClients(mcpClientsConfig, eventSourceConfig);

      expect(manager.getEventSourceNames()).toContain("timer");
      expect(manager.getEventSourceNames()).not.toContain("webhook");
    });
  });

  describe("getStatus", () => {
    test("should return undefined for unknown client", () => {
      expect(manager.getStatus("unknown")).toBeUndefined();
    });
  });

  describe("getAllStatus", () => {
    test("should return empty map initially", () => {
      expect(manager.getAllStatus().size).toBe(0);
    });
  });

  describe("getClients", () => {
    test("should return empty map initially", () => {
      expect(manager.getClients().size).toBe(0);
    });
  });

  describe("getEventSourceNames", () => {
    test("should return empty array initially", () => {
      expect(manager.getEventSourceNames()).toEqual([]);
    });
  });

  describe("getClient", () => {
    test("should return undefined for unknown client", () => {
      expect(manager.getClient("unknown")).toBeUndefined();
    });
  });
});
