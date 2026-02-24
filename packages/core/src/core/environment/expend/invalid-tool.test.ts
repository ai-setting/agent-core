/**
 * @fileoverview Unit tests for InvalidTool.
 */

import { describe, test, expect } from "bun:test";
import { createInvalidTool } from "./invalid-tool.js";
import { InvalidToolParameters } from "./invalid-tool.js";

describe("InvalidTool - Parameters Validation", () => {
  test("should have correct parameter schema", () => {
    expect(InvalidToolParameters.shape.tool).toBeDefined();
    expect(InvalidToolParameters.shape.error).toBeDefined();
  });

  test("should parse valid parameters", () => {
    const params = InvalidToolParameters.parse({
      tool: "read_file",
      error: "Invalid JSON in arguments",
    });

    expect(params.tool).toBe("read_file");
    expect(params.error).toBe("Invalid JSON in arguments");
  });
});

describe("InvalidTool - Tool Definition", () => {
  test("should create invalid tool with correct name", () => {
    const tool = createInvalidTool();
    expect(tool.name).toBe("invalid");
  });

  test("should have internal-only description", () => {
    const tool = createInvalidTool();
    expect(tool.description).toContain("Internal tool");
    expect(tool.description).toContain("Do not call this tool directly");
  });

  test("should have correct parameter schema", () => {
    const tool = createInvalidTool();
    const params = tool.parameters.parse({ tool: "test", error: "test" });
    expect(params.tool).toBe("test");
    expect(params.error).toBe("test");
  });
});

describe("InvalidTool - Execution", () => {
  test("should return error result with tool and error info", async () => {
    const tool = createInvalidTool();
    const mockContext = {
      session_id: "test-session",
      message_id: "test-message",
    };

    const result = await tool.execute(
      {
        tool: "read_file",
        error: "Invalid JSON in arguments: {invalid json}",
      },
      mockContext as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid JSON in arguments");
    expect(result.error).toContain("are invalid");
    expect(result.metadata).toBeDefined();
    expect(result.metadata!.original_tool).toBe("read_file");
  });

  test("should handle doom loop error", async () => {
    const tool = createInvalidTool();
    const mockContext = {
      session_id: "test-session",
      message_id: "test-message",
    };

    const result = await tool.execute(
      {
        tool: "read_file",
        error: 'Doom loop detected: tool "read_file" has been called 3 times with the same arguments',
      },
      mockContext as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Doom loop detected");
    expect(result.metadata!.original_tool).toBe("read_file");
  });

  test("should handle unavailable tool error", async () => {
    const tool = createInvalidTool();
    const mockContext = {
      session_id: "test-session",
      message_id: "test-message",
    };

    const result = await tool.execute(
      {
        tool: "nonexistent_tool",
        error: 'Tool "nonexistent_tool" is not available',
      },
      mockContext as any
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("nonexistent_tool");
    expect(result.metadata!.original_tool).toBe("nonexistent_tool");
  });

  test("should include execution time in metadata", async () => {
    const tool = createInvalidTool();
    const mockContext = {
      session_id: "test-session",
      message_id: "test-message",
    };

    const startTime = Date.now();
    const result = await tool.execute(
      { tool: "test", error: "test error" },
      mockContext as any
    );
    const endTime = Date.now();

    expect(result.metadata!.execution_time_ms).toBeGreaterThanOrEqual(0);
    expect(result.metadata!.execution_time_ms).toBeLessThanOrEqual(endTime - startTime + 10);
  });
});
