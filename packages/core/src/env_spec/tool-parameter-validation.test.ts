/**
 * @fileoverview Tests for tool parameter validation.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { z } from "zod";
import { BaseEnvironment } from "../core/environment/base/base-environment.js";
import type { Action, Context, ToolResult } from "../core/types/index.js";

class TestEnvWithValidation extends BaseEnvironment {
  constructor() {
    super({ systemPrompt: "You are a test env." });

    // Register a tool with required 'reason' parameter
    this.registerTool({
      name: "tool_with_reason",
      description: "A tool that requires a reason parameter",
      parameters: z.object({
        message: z.string().describe("The message to process"),
        reason: z.string().describe("Brief reason for calling this tool (max 30 chars)"),
      }),
      async execute(args) {
        return {
          success: true,
          output: `Processed: ${args.message}`,
          metadata: { execution_time_ms: 0 }
        } as ToolResult;
      },
    });

    // Register a tool with optional parameters
    this.registerTool({
      name: "tool_optional",
      description: "A tool with optional parameters",
      parameters: z.object({
        message: z.string().describe("The message to process"),
        optionalParam: z.string().optional().describe("An optional parameter"),
      }),
      async execute(args) {
        return {
          success: true,
          output: `Processed: ${args.message}`,
          metadata: { execution_time_ms: 0 }
        } as ToolResult;
      },
    });
  }

  protected getDefaultTimeout(): number {
    return 1000;
  }
  protected getTimeoutOverride(_action: Action): number | undefined {
    return undefined;
  }
  protected getMaxRetries(): number {
    return 0;
  }
  protected getRetryDelay(): number {
    return 0;
  }
  protected isRetryableError(): boolean {
    return false;
  }
  protected getConcurrencyLimit(): number {
    return 1;
  }
  protected getRecoveryStrategy(): {
    type: "retry" | "fallback" | "skip" | "error";
    maxRetries?: number | undefined;
    fallbackTool?: string | undefined;
  } {
    return { type: "error" };
  }
  protected getSkillsDirectory(): string | undefined {
    return undefined;
  }
}

describe("Tool Parameter Validation", () => {
  let env: TestEnvWithValidation;
  let ctx: Context;

  beforeEach(() => {
    env = new TestEnvWithValidation();
    ctx = {
      session_id: "test-session",
      message_id: "test-message",
      workdir: "/tmp",
    };
  });

  describe("Required parameter validation", () => {
    it("should fail when required parameter is missing", async () => {
      const action: Action = {
        tool_name: "tool_with_reason",
        args: { message: "hello" }, // missing 'reason'
      };

      const result = await env.handle_action(action, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain("reason");
      expect(result.error).toContain("Required");
    });

    it("should succeed when all required parameters are provided", async () => {
      const action: Action = {
        tool_name: "tool_with_reason",
        args: { message: "hello", reason: "Test reason" },
      };

      const result = await env.handle_action(action, ctx);

      expect(result.success).toBe(true);
      expect(result.output).toContain("Processed: hello");
    });

    it("should include detailed error message with parameter path", async () => {
      const action: Action = {
        tool_name: "tool_with_reason",
        args: { message: "hello" }, // missing 'reason'
      };

      const result = await env.handle_action(action, ctx);

      // Should contain the field name that failed validation
      expect(result.error).toMatch(/reason|Invalid parameters/);
    });
  });

  describe("Optional parameter validation", () => {
    it("should succeed when optional parameter is missing", async () => {
      const action: Action = {
        tool_name: "tool_optional",
        args: { message: "hello" }, // optionalParam is not required
      };

      const result = await env.handle_action(action, ctx);

      expect(result.success).toBe(true);
    });

    it("should succeed when optional parameter is provided", async () => {
      const action: Action = {
        tool_name: "tool_optional",
        args: { message: "hello", optionalParam: "world" },
      };

      const result = await env.handle_action(action, ctx);

      expect(result.success).toBe(true);
    });
  });

  describe("Error message for LLM consumption", () => {
    it("should return error in a format that LLM can understand and fix", async () => {
      const action: Action = {
        tool_name: "tool_with_reason",
        args: { message: "test" }, // missing required 'reason'
      };

      const result = await env.handle_action(action, ctx);

      // The error message should be clear and actionable
      expect(result.error).toBeDefined();
      expect(result.error!.length).toBeGreaterThan(0);

      // The error should indicate which parameter is missing
      const errorLower = result.error!.toLowerCase();
      expect(
        errorLower.includes("reason") ||
        errorLower.includes("required") ||
        errorLower.includes("invalid")
      ).toBe(true);
    });

    it("should return success: false so LLM knows to retry with corrected params", async () => {
      const action: Action = {
        tool_name: "tool_with_reason",
        args: { message: "test" },
      };

      const result = await env.handle_action(action, ctx);

      expect(result.success).toBe(false);
      // The error message should be in the output or error field
      expect(result.error || result.output).toBeDefined();
    });
  });
});
