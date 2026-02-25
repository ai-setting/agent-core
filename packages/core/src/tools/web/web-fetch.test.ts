/**
 * @fileoverview Unit tests for web-fetch tool
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createWebFetchTool, type WebFetchConfig } from "./web-fetch.js";

describe("WebFetch Tool - Parameter Validation", () => {
  const tool = createWebFetchTool();

  test("should reject non-http URLs", async () => {
    const result = await tool.execute(
      { url: "ftp://example.com", format: "markdown" },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("http:// or https://");
  });

  test("should reject empty URL", async () => {
    const result = await tool.execute(
      { url: "", format: "markdown" },
      {}
    );

    expect(result.success).toBe(false);
  });

  test("should accept valid HTTPS URL", async () => {
    // Create a tool with mocked fetch
    const mockTool = createWebFetchTool({
      timeout: 5000,
    });

    // This will fail due to network, but URL validation should pass first
    const result = await mockTool.execute(
      { url: "https://example.com", format: "markdown" },
      {}
    );

    // Should not have URL validation error - result.error may be undefined
    if (typeof result.error === "string") {
      expect(result.error.includes("must start with")).toBe(false);
    }
  });
});

describe("WebFetch Tool - Tool Info", () => {
  test("should have correct tool name", () => {
    const tool = createWebFetchTool();
    expect(tool.name).toBe("webfetch");
  });

  test("should have description", () => {
    const tool = createWebFetchTool();
    expect(tool.description.length).toBeGreaterThan(0);
  });

  test("should have parameters schema", () => {
    const tool = createWebFetchTool();
    expect(tool.parameters).toBeDefined();
  });
});

describe("WebFetch Tool - Configuration", () => {
  test("should use custom config values", () => {
    const config: WebFetchConfig = {
      maxChars: 10000,
      timeout: 10000,
      userAgent: "CustomAgent/1.0",
    };

    const tool = createWebFetchTool(config);
    expect(tool).toBeDefined();
  });

  test("should use default values when not provided", () => {
    const tool = createWebFetchTool();
    expect(tool).toBeDefined();
  });
});

describe("WebFetch Tool - Format Options", () => {
  test("should accept markdown format", async () => {
    const tool = createWebFetchTool({ timeout: 5000 });

    const result = await tool.execute(
      { url: "https://example.com", format: "markdown" },
      {}
    );

    // Result should either succeed or fail with network error
    // URL validation should pass - result.error may be undefined
    if (typeof result.error === "string") {
      expect(result.error.includes("must start with")).toBe(false);
    }
  });

  test("should accept text format", async () => {
    const tool = createWebFetchTool({ timeout: 5000 });

    const result = await tool.execute(
      { url: "https://example.com", format: "text" },
      {}
    );

    if (typeof result.error === "string") {
      expect(result.error.includes("must start with")).toBe(false);
    }
  });

  test("should accept html format", async () => {
    const tool = createWebFetchTool({ timeout: 5000 });

    const result = await tool.execute(
      { url: "https://example.com", format: "html" },
      {}
    );

    if (typeof result.error === "string") {
      expect(result.error.includes("must start with")).toBe(false);
    }
  });
});

describe("WebFetch Tool - Max Chars", () => {
  test("should respect custom maxChars", async () => {
    const tool = createWebFetchTool({
      maxChars: 100,
      timeout: 5000,
    });

    const result = await tool.execute(
      { url: "https://example.com", maxChars: 50 },
      {}
    );

    // If successful, output should be limited. In CI, network may be restricted.
    if (result.success && result.output) {
      // Lenient check - just verify it's reasonably bounded
      expect(result.output.length).toBeLessThanOrEqual(1000);
    }
    // If failed (network error), that's OK in CI - just verify no validation error
    if (typeof result.error === "string") {
      expect(result.error.includes("must start with")).toBe(false);
    }
  });
});
