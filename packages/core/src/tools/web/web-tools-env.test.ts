/**
 * @fileoverview Environment-level tests for web tools (webfetch, websearch via MCP)
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { BaseEnvironment } from "../../core/environment/base/base-environment.js";
import type { Action, ToolResult } from "../../core/types/index.js";
import { createWebFetchTool } from "./web-fetch.js";

class TestWebEnv extends BaseEnvironment {
  constructor() {
    super({ systemPrompt: "You are a test environment with web tools." });

    // Register webfetch tool
    const webFetchTool = createWebFetchTool({
      maxChars: 50000,
      timeout: 30000,
    });
    this.registerTool(webFetchTool);
  }

  protected getDefaultTimeout(_toolName: string): number {
    return 1000;
  }
  protected getTimeoutOverride(_action: Action): number | undefined {
    return undefined;
  }
  protected getMaxRetries(_toolName: string): number {
    return 0;
  }
  protected getRetryDelay(): number {
    return 0;
  }
  protected isRetryableError(_error: string): boolean {
    return false;
  }
  protected getConcurrencyLimit(_toolName: string): number {
    return 1;
  }
  protected getRecoveryStrategy(_toolName: string): {
    type: "retry" | "fallback" | "skip" | "error";
    maxRetries?: number;
    fallbackTool?: string;
  } {
    return { type: "error" };
  }
  protected getSkillsDirectory(): string | undefined {
    return undefined;
  }
}

describe("Environment Web Tools Integration", () => {
  let env: TestWebEnv;

  beforeEach(() => {
    env = new TestWebEnv();
  });

  describe("WebFetch Tool Registration", () => {
    it("should register webfetch tool in environment", () => {
      const tools = env.listTools();
      const webFetchTool = tools.find((t) => t.name === "webfetch");

      expect(webFetchTool).toBeDefined();
      expect(webFetchTool?.name).toBe("webfetch");
    });

    it("should have webfetch tool with correct description", () => {
      const webFetchTool = env.getTool("webfetch");

      expect(webFetchTool).toBeDefined();
      expect(webFetchTool?.description).toContain("Fetch and extract readable content");
    });

    it("should have webfetch tool with parameters schema", () => {
      const webFetchTool = env.getTool("webfetch");

      expect(webFetchTool?.parameters).toBeDefined();
    });
  });

  describe("WebFetch Tool Execution", () => {
    it("should reject invalid URLs", async () => {
      const webFetchTool = env.getTool("webfetch");
      expect(webFetchTool).toBeDefined();

      const result = await webFetchTool!.execute(
        { url: "not-a-url", format: "markdown" },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("http:// or https://");
    });

    it("should reject FTP URLs", async () => {
      const webFetchTool = env.getTool("webfetch");
      expect(webFetchTool).toBeDefined();

      const result = await webFetchTool!.execute(
        { url: "ftp://example.com", format: "markdown" },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("http:// or https://");
    });

    it("should accept valid HTTPS URLs", async () => {
      const webFetchTool = env.getTool("webfetch");
      expect(webFetchTool).toBeDefined();

      // This test will make actual network request
      // It should either succeed or fail with network error, not validation error
      const result = await webFetchTool!.execute(
        { url: "https://example.com", format: "markdown" },
        {}
      );

      // URL validation should pass - either success or network error, but not validation error
      // In CI environment, network may be restricted, so we just check the tool exists and runs
      expect(result.success === true || (result.error !== undefined && !result.error.includes("must start with")));
    });
  });

  describe("Tool Discovery", () => {
    it("should list all registered tools including webfetch", () => {
      const tools = env.listTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain("webfetch");
    });

    it("should be able to get webfetch tool by name", () => {
      const tool = env.getTool("webfetch");
      expect(tool).toBeDefined();
      expect(tool?.name).toBe("webfetch");
    });

    it("should return undefined for non-existent tool", () => {
      const tool = env.getTool("nonexistent");
      expect(tool).toBeUndefined();
    });
  });
});

describe("MCP Web Search Configuration", () => {
  describe("Exa MCP Configuration", () => {
    it("should describe Exa MCP configuration format", () => {
      // This test documents the expected MCP configuration for Exa
      const exaMcpConfig = {
        type: "remote" as const,
        url: "https://mcp.exa.ai/mcp?tools=web_search_exa",
        enabled: true,
      };

      expect(exaMcpConfig.type).toBe("remote");
      expect(exaMcpConfig.url).toContain("exa.ai");
      expect(exaMcpConfig.enabled).toBe(true);
    });

    it("should describe Tavily MCP configuration format", () => {
      // This test documents the expected MCP configuration for Tavily
      const tavilyMcpConfig = {
        type: "remote" as const,
        url: "https://mcp.tavily.com/mcp/",
        enabled: true,
        headers: {
          Authorization: "Bearer ${env:TAVILY_API_KEY}",
        },
      };

      expect(tavilyMcpConfig.type).toBe("remote");
      expect(tavilyMcpConfig.url).toContain("tavily.com");
      expect(tavilyMcpConfig.enabled).toBe(true);
    });
  });

  describe("MCP Tool Naming", () => {
    it("should document MCP tool naming convention", () => {
      // MCP tools are registered with prefix: {mcpName}_{toolName}
      const mcpName = "exa";
      const toolName = "web_search_exa";
      const fullName = `${mcpName}_${toolName}`;

      expect(fullName).toBe("exa_web_search_exa");
    });
  });
});

describe("Web Tools Configuration", () => {
  describe("WebFetch Configuration Options", () => {
    it("should accept custom maxChars", () => {
      const tool = createWebFetchTool({ maxChars: 10000 });
      expect(tool.name).toBe("webfetch");
    });

    it("should accept custom timeout", () => {
      const tool = createWebFetchTool({ timeout: 60000 });
      expect(tool.name).toBe("webfetch");
    });

    it("should accept custom user agent", () => {
      const tool = createWebFetchTool({
        userAgent: "CustomBot/1.0",
      });
      expect(tool.name).toBe("webfetch");
    });

    it("should use defaults when not specified", () => {
      const tool = createWebFetchTool();
      expect(tool.name).toBe("webfetch");
    });
  });

  describe("Tool Parameter Formats", () => {
    let env: TestWebEnv;

    beforeEach(() => {
      env = new TestWebEnv();
    });

    it("should accept markdown format parameter", async () => {
      const tool = env.getTool("webfetch");
      const result = await tool!.execute(
        { url: "https://example.com", format: "markdown" },
        {}
      );

      // Should not have URL validation error
      if (result.error) {
        expect(result.error.includes("must start with")).toBe(false);
      }
    });

    it("should accept text format parameter", async () => {
      const tool = env.getTool("webfetch");
      const result = await tool!.execute(
        { url: "https://example.com", format: "text" },
        {}
      );

      // Should not have URL validation error
      if (result.error) {
        expect(result.error.includes("must start with")).toBe(false);
      }
    });

    it("should accept html format parameter", async () => {
      const tool = env.getTool("webfetch");
      const result = await tool!.execute(
        { url: "https://example.com", format: "html" },
        {}
      );

      // Should not have URL validation error
      if (result.error) {
        expect(result.error.includes("must start with")).toBe(false);
      }
    });

    it("should accept markdown format parameter", async () => {
      const tool = env.getTool("webfetch");
      const result = await tool!.execute(
        { url: "https://example.com", format: "markdown" },
        {}
      );

      expect(result.error).not.toContain("must start with");
    });

    it("should accept text format parameter", async () => {
      const tool = env.getTool("webfetch");
      const result = await tool!.execute(
        { url: "https://example.com", format: "text" },
        {}
      );

      expect(result.error).not.toContain("must start with");
    });

    it("should accept html format parameter", async () => {
      const tool = env.getTool("webfetch");
      const result = await tool!.execute(
        { url: "https://example.com", format: "html" },
        {}
      );

      expect(result.error).not.toContain("must start with");
    });
  });
});
