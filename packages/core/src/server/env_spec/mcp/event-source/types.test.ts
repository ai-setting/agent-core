/**
 * @fileoverview EventSource MCP 模块单元测试
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "bun:test";
import { z } from "zod";
import {
  EventSourceConfigSchema,
  EventSourceMcpConfigSchema,
  EventSourceStatus,
  EventSourceOptions,
} from "./types.js";

describe("EventSourceConfigSchema", () => {
  test("should parse minimal local config", () => {
    const config = {
      name: "timer-source",
      type: "local" as const,
      command: ["bun", "run", "timer-server.mjs"],
    };

    const result = EventSourceConfigSchema.parse(config);
    expect(result.name).toBe("timer-source");
    expect(result.type).toBe("local");
    expect(result.enabled).toBe(true);
  });

  test("should parse full remote config with all options", () => {
    const config = {
      name: "webhook-source",
      type: "remote" as const,
      url: "https://events.example.com/mcp",
      enabled: true,
      timeout: 60000,
      headers: {
        Authorization: "Bearer token",
      },
    };

    const result = EventSourceConfigSchema.parse(config);
    expect(result.name).toBe("webhook-source");
    expect(result.type).toBe("remote");
    expect(result.url).toBe("https://events.example.com/mcp");
    expect(result.enabled).toBe(true);
    expect(result.timeout).toBe(60000);
  });

  test("should parse config with metadata", () => {
    const config = {
      name: "custom-source",
      type: "local" as const,
      command: ["bun", "run", "custom.mjs"],
      metadata: {
        interval: 5000,
        eventTypes: ["timer.tick", "timer.hourly"],
      },
    };

    const result = EventSourceConfigSchema.parse(config);
    expect(result.metadata?.interval).toBe(5000);
    expect(result.metadata?.eventTypes).toEqual(["timer.tick", "timer.hourly"]);
  });

  test("should apply default values", () => {
    const config = {
      name: "test-source",
      type: "local" as const,
      command: ["bun", "run", "test.mjs"],
    };

    const result = EventSourceConfigSchema.parse(config);
    expect(result.enabled).toBe(true);
    expect(result.timeout).toBe(30000);
  });

  test("should reject config without name", () => {
    const config = {
      type: "local" as const,
      command: ["bun", "run", "test.mjs"],
    };

    expect(() => EventSourceConfigSchema.parse(config)).toThrow();
  });

  test("should reject local type without command", () => {
    const config = {
      name: "test-source",
      type: "local" as const,
    };

    expect(() => EventSourceConfigSchema.parse(config)).toThrow();
  });

  test("should reject enabled remote without url", () => {
    const config = {
      name: "test-source",
      type: "remote" as const,
      enabled: true,
    };

    expect(() => EventSourceConfigSchema.parse(config)).toThrow();
  });

  test("should allow disabled remote without url", () => {
    const config = {
      name: "test-source",
      type: "remote" as const,
      enabled: false,
    };

    const result = EventSourceConfigSchema.parse(config);
    expect(result.enabled).toBe(false);
  });

  test("should parse config with eventTypes", () => {
    const config = {
      name: "timer-source",
      type: "local" as const,
      command: ["bun", "run", "timer.mjs"],
      eventTypes: ["timer.heartbeat", "timer.tick"],
    };

    const result = EventSourceConfigSchema.parse(config);
    expect(result.eventTypes).toEqual(["timer.heartbeat", "timer.tick"]);
  });
});

describe("EventSourceMcpConfigSchema", () => {
  test("should parse minimal config", () => {
    const config = {};

    const result = EventSourceMcpConfigSchema.parse(config);
    expect(result.enabled).toBe(true);
    expect(result.autoStart).toBe(true);
  });

  test("should parse config with sources", () => {
    const config = {
      enabled: true,
      autoStart: true,
      sources: {
        "timer-source": {
          name: "timer-source",
          enabled: true,
          options: {
            eventTypes: ["timer.tick", "timer.heartbeat"],
          },
        },
        "webhook-source": {
          name: "webhook-source",
          enabled: true,
          options: {
            eventTypes: ["webhook.*"],
          },
        },
      },
    };

    const result = EventSourceMcpConfigSchema.parse(config);
    expect(result.enabled).toBe(true);
    expect(result.sources?.["timer-source"]).toBeDefined();
    expect(result.sources?.["webhook-source"]).toBeDefined();
  });

  test("should parse config with disabled source", () => {
    const config = {
      sources: {
        "disabled-source": {
          name: "disabled-source",
          enabled: false,
        },
      },
    };

    const result = EventSourceMcpConfigSchema.parse(config);
    expect(result.sources?.["disabled-source"]?.enabled).toBe(false);
  });

  test("should apply default values", () => {
    const config = {
      sources: {
        "test-source": {
          name: "test-source",
        },
      },
    };

    const result = EventSourceMcpConfigSchema.parse(config);
    expect(result.enabled).toBe(true);
    expect(result.autoStart).toBe(true);
    expect(result.sources?.["test-source"]?.enabled).toBe(true);
  });
});

describe("EventSourceStatus", () => {
  test("should have correct status values", () => {
    expect(EventSourceStatus.STOPPED).toBe(EventSourceStatus.STOPPED);
    expect(EventSourceStatus.STARTING).toBe(EventSourceStatus.STARTING);
    expect(EventSourceStatus.RUNNING).toBe(EventSourceStatus.RUNNING);
    expect(EventSourceStatus.STOPPING).toBe(EventSourceStatus.STOPPING);
    expect(EventSourceStatus.ERROR).toBe(EventSourceStatus.ERROR);
  });
});

describe("EventSourceOptions", () => {
  test("should allow eventTypes filter", () => {
    const options: EventSourceOptions = {
      eventTypes: ["timer.heartbeat", "webhook.*"],
    };
    expect(options.eventTypes).toEqual(["timer.heartbeat", "webhook.*"]);
  });

  test("should allow pollInterval", () => {
    const options: EventSourceOptions = {
      pollInterval: 5000,
    };
    expect(options.pollInterval).toBe(5000);
  });

  test("should allow metadata", () => {
    const options: EventSourceOptions = {
      metadata: {
        location: "server-room-1",
        priority: "high",
      },
    };
    expect(options.metadata?.location).toBe("server-room-1");
  });
});
