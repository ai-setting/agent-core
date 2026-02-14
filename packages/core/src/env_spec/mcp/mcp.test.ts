/**
 * @fileoverview MCP 模块单元测试
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { McpServerLoader, type DiscoveredMcpServer } from "./loader.js";
import { McpManager } from "./manager.js";
import { convertMcpTool, createMcpToolsDescription } from "./convert.js";
import { 
  McpServerConfigSchema, 
  McpClientConfigSchema,
  McpConfigSchema 
} from "./types.js";
import { z } from "zod";

describe("McpServerLoader", () => {
  test("should parse McpServerConfigSchema", () => {
    const config = {
      enabled: true,
      transport: "http" as const,
      http: {
        port: 3000,
        host: "0.0.0.0"
      }
    };
    
    const result = McpServerConfigSchema.parse(config);
    expect(result.enabled).toBe(true);
    expect(result.transport).toBe("http");
    expect(result.http?.port).toBe(3000);
  });

  test("should parse McpClientLocalSchema", () => {
    const config = {
      type: "local" as const,
      command: ["bun", "run", "./server.mjs"],
      enabled: true,
      timeout: 30000
    };
    
    const parsed = McpClientConfigSchema.parse(config);
    // 使用类型守卫检查
    if (parsed.type === "local") {
      expect(parsed.command).toEqual(["bun", "run", "./server.mjs"]);
      expect(parsed.enabled).toBe(true);
      expect(parsed.timeout).toBe(30000);
    }
  });

  test("should parse McpClientRemoteSchema", () => {
    const config = {
      type: "remote" as const,
      url: "https://mcp.example.com",
      enabled: true,
      headers: {
        "Authorization": "Bearer token"
      }
    };
    
    const parsed = McpClientConfigSchema.parse(config);
    if (parsed.type === "remote") {
      expect(parsed.url).toBe("https://mcp.example.com");
      expect(parsed.headers?.Authorization).toBe("Bearer token");
    }
  });

  test("should parse McpClientRemoteSchema with OAuth", () => {
    const config = {
      type: "remote" as const,
      url: "https://mcp.example.com",
      oauth: {
        clientId: "client-id",
        clientSecret: "client-secret",
        scope: "tools:read"
      }
    };
    
    const parsed = McpClientConfigSchema.parse(config);
    if (parsed.type === "remote" && parsed.oauth && typeof parsed.oauth !== "boolean") {
      expect(parsed.oauth.clientId).toBe("client-id");
      expect(parsed.oauth.clientSecret).toBe("client-secret");
      expect(parsed.oauth.scope).toBe("tools:read");
    }
  });

  test("should parse McpConfigSchema", () => {
    const config = {
      server: {
        enabled: true,
        transport: "http"
      },
      clients: {
        "test-server": {
          type: "local" as const,
          command: ["bun", "run", "./test.mjs"]
        }
      }
    };
    
    const result = McpConfigSchema.parse(config);
    expect(result.server?.enabled).toBe(true);
    expect(result.clients?.["test-server"]).toBeDefined();
  });

  test("should parse enabled-only remote config", () => {
    const config = {
      clients: {
        "remote-server": {
          enabled: false
        }
      }
    };
    
    const result = McpConfigSchema.parse(config);
    expect(result.clients?.["remote-server"]).toEqual({ enabled: false });
  });
});

describe("McpManager", () => {
  test("should create McpManager instance", () => {
    const manager = new McpManager();
    expect(manager).toBeDefined();
  });

  test("should create McpManager with directory", () => {
    const manager = new McpManager("/some/path");
    expect(manager).toBeDefined();
  });

  test("should return empty tools initially", () => {
    const manager = new McpManager();
    const tools = manager.getTools();
    expect(tools).toEqual([]);
  });

  test("should return tools description", () => {
    const manager = new McpManager();
    const description = manager.getToolsDescription();
    expect(description).toContain("No MCP tools");
  });

  test("should return client status undefined for unknown client", () => {
    const manager = new McpManager();
    const status = manager.getClientStatus("unknown");
    expect(status).toBeUndefined();
  });

  test("should return tools count", () => {
    const manager = new McpManager();
    const count = manager.getToolsCount();
    expect(count).toBe(0);
  });

  test("should check hasClient returns false for unknown client", () => {
    const manager = new McpManager();
    expect(manager.hasClient("unknown")).toBe(false);
  });
});

describe("createMcpToolsDescription", () => {
  test("should return no tools message for empty array", () => {
    const result = createMcpToolsDescription([]);
    expect(result).toContain("No MCP tools");
  });

  test("should format tools correctly", () => {
    const tools = [
      {
        name: "filesystem_read",
        description: "Read file from filesystem",
        parameters: z.object({}),
        execute: async () => ({ success: true, output: "" })
      },
      {
        name: "filesystem_write",
        description: "Write file to filesystem",
        parameters: z.object({}),
        execute: async () => ({ success: true, output: "" })
      }
    ];
    
    const result = createMcpToolsDescription(tools);
    expect(result).toContain("filesystem_read");
    expect(result).toContain("filesystem_write");
    expect(result).toContain("Read file from filesystem");
  });
});
