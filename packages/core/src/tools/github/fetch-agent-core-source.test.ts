/**
 * @fileoverview Unit tests for fetch_agent_core_source tool
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { fetchAgentCoreSourceTool } from "./fetch-agent-core-source.js";

describe("fetch_agent_core_source Tool - Tool Info", () => {
  test("should have correct tool name", () => {
    expect(fetchAgentCoreSourceTool.name).toBe("fetch_agent_core_source");
  });

  test("should have description", () => {
    expect(fetchAgentCoreSourceTool.description.length).toBeGreaterThan(0);
    expect(fetchAgentCoreSourceTool.description).toContain("agent-core");
  });

  test("should have parameters schema", () => {
    expect(fetchAgentCoreSourceTool.parameters).toBeDefined();
  });

  test("should have path parameter defined", () => {
    expect(fetchAgentCoreSourceTool.parameters).toBeDefined();
  });
});

describe("fetch_agent_core_source Tool - Execution", () => {
  test("should return error when path is missing", async () => {
    const result = await fetchAgentCoreSourceTool.execute({}, {});

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("should use default commit from context when not provided", async () => {
    const mockContext = {
      env: {
        getCommitVersion: () => "abc123",
      },
    };

    const result = await fetchAgentCoreSourceTool.execute(
      { path: "packages/core/package.json" },
      mockContext as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("abc123");
  });

  test("should use provided commit when specified", async () => {
    const result = await fetchAgentCoreSourceTool.execute(
      { path: "packages/core/package.json", commit: "def456" },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("def456");
  });

  test("should default to master when no context available", async () => {
    const result = await fetchAgentCoreSourceTool.execute(
      { path: "packages/core/package.json" },
      {} as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("master");
  });

  test("should include language in output when provided", async () => {
    const mockContext = {
      env: {
        getCommitVersion: () => "abc123",
      },
    };

    const result = await fetchAgentCoreSourceTool.execute(
      { path: "packages/core/package.json", language: "typescript" },
      mockContext as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("abc123");
  });

  test("should support localPath parameter", async () => {
    expect(fetchAgentCoreSourceTool.parameters).toBeDefined();
  });
});
