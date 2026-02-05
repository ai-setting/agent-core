/**
 * @fileoverview Unit tests for the Tool framework.
 * Tests tool definition, validation, and execution patterns.
 */

import { tool, define } from "../../src/tool/core";
import { z } from "zod";
import { describe, test, expect, beforeEach, afterEach, vi } from "bun:test";

describe("tool helper function", () => {
  describe("basic tool creation", () => {
    test("creates tool with name and description", () => {
      const myTool = tool({
        name: "my_tool",
        description: "A test tool",
        parameters: z.object({
          input: z.string(),
        }),
        execute: async (args) => {
          return { success: true, output: args.input };
        },
      });

      expect(myTool.name).toBe("my_tool");
      expect(myTool.description).toBe("A test tool");
    });

    test("generates name from info if not provided", () => {
      const myTool = tool({
        description: "A test tool",
        parameters: z.object({}),
        execute: async () => ({ success: true, output: "" }),
      });

      expect(myTool.name).toBe("");
    });

    test("uses default empty description", () => {
      const myTool = tool({
        parameters: z.object({}),
        execute: async () => ({ success: true, output: "" }),
      });

      expect(myTool.description).toBe("");
    });
  });

  describe("parameters validation", () => {
    test("validates required parameters", async () => {
      const myTool = tool({
        name: "validated_tool",
        description: "Tool with validation",
        parameters: z.object({
          name: z.string().min(1),
          age: z.number().positive(),
        }),
        execute: async (args) => {
          return { success: true, output: JSON.stringify(args) };
        },
      });

      // Valid params
      const validResult = await myTool.execute({ name: "test", age: 25 }, {} as any);
      expect(validResult.success).toBe(true);

      // Invalid params - tool doesn't validate, caller must validate
      // The tool definition stores the schema for external validation
      expect(myTool.parameters).toBeDefined();
    });
  });

  describe("execute function", () => {
    test("executes tool with args", async () => {
      const myTool = tool({
        name: "echo",
        description: "Echoes input",
        parameters: z.object({
          message: z.string(),
        }),
        execute: async (args) => {
          return { success: true, output: args.message };
        },
      });

      const result = await myTool.execute({ message: "hello" }, {} as any);
      expect(result.success).toBe(true);
      expect(result.output).toBe("hello");
    });

    test("handles execution errors", async () => {
      const myTool = tool({
        name: "failing_tool",
        description: "Always fails",
        parameters: z.object({}),
        execute: async () => {
          throw new Error("Execution failed");
        },
      });

      await expect(myTool.execute({}, {} as any)).rejects.toThrow("Execution failed");
    });

    test("receives context", async () => {
      const receivedContext = {} as any;

      const myTool = tool({
        name: "context_test",
        description: "Tests context",
        parameters: z.object({}),
        execute: async (args, ctx) => {
          return { success: true, output: ctx.session_id };
        },
      });

      const result = await myTool.execute({}, receivedContext);
      expect(result.success).toBe(true);
    });
  });

  describe("init function", () => {
    test("supports async init", async () => {
      let initCalled = false;

      const myTool = tool({
        name: "initialized_tool",
        description: "Tool with init",
        parameters: z.object({}),
        init: async () => {
          initCalled = true;
        },
        execute: async () => {
          return { success: true, output: "done" };
        },
      });

      // Init should be available for caller to invoke
      expect(myTool.init).toBeDefined();
    });
  });

  describe("formatValidationError", () => {
    test("supports custom error formatting", () => {
      const myTool = tool({
        name: "custom_error",
        description: "Custom error format",
        parameters: z.object({
          value: z.string(),
        }),
        formatValidationError: (error) => {
          return `Invalid value: ${error.errors[0].message}`;
        },
        execute: async () => ({ success: true, output: "" }),
      });

      expect(myTool.formatValidationError).toBeDefined();
    });
  });
});

describe("define function", () => {
  describe("string name overload", () => {
    test("creates minimal tool from name", () => {
      const myTool = define("minimal_tool");

      expect(myTool.name).toBe("minimal_tool");
      expect(myTool.parameters).toBeDefined();
    });

    test("creates tool with init function", () => {
      const myTool = define("tool_with_init", async () => ({
        description: "Initialized tool",
        parameters: z.object({}),
        execute: async () => ({ success: true, output: "" }),
      }));

      expect(myTool.name).toBe("tool_with_init");
      expect(myTool.description).toBe(""); // description will be from init result
    });
  });

  describe("info object overload", () => {
    test("creates tool from info object", () => {
      const myTool = define({
        name: "info_tool",
        description: "From info",
        parameters: z.object({}),
        execute: async () => ({ success: true, output: "info" }),
      });

      expect(myTool.name).toBe("info_tool");
      expect(myTool.description).toBe("From info");
    });

    test("omits name if not provided", () => {
      const myTool = define({
        description: "No name",
        parameters: z.object({}),
        execute: async () => ({ success: true, output: "" }),
      });

      expect(myTool.name).toBe("");
    });
  });
});

describe("tool with Zod schemas", () => {
  describe("complex parameter types", () => {
    test("handles nested objects", async () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          profile: z.object({
            age: z.number(),
            email: z.string().email(),
          }),
        }),
      });

      const myTool = tool({
        name: "nested_params",
        description: "Nested object parameters",
        parameters: schema,
        execute: async (args) => {
          return { success: true, output: args.user.name };
        },
      });

      const validArgs = {
        user: {
          name: "John",
          profile: { age: 30, email: "john@example.com" },
        },
      };

      const result = await myTool.execute(validArgs, {} as any);
      expect(result.success).toBe(true);
      expect(result.output).toBe("John");
    });

    test("handles arrays", async () => {
      const schema = z.object({
        items: z.array(z.string()),
        count: z.number().min(1).max(10),
      });

      const myTool = tool({
        name: "array_params",
        description: "Array parameters",
        parameters: schema,
        execute: async (args) => {
          return { success: true, output: args.items.length.toString() };
        },
      });

      const result = await myTool.execute(
        { items: ["a", "b", "c"], count: 3 },
        {} as any,
      );
      expect(result.success).toBe(true);
      expect(result.output).toBe("3");
    });

    test("handles union types", async () => {
      const schema = z.object({
        mode: z.enum(["read", "write", "delete"]),
        data: z.union([z.string(), z.number()]),
      });

      const myTool = tool({
        name: "union_params",
        description: "Union type parameters",
        parameters: schema,
        execute: async (args) => {
          return { success: true, output: typeof args.data };
        },
      });

      const result1 = await myTool.execute({ mode: "read", data: "hello" }, {} as any);
      expect(result1.output).toBe("string");

      const result2 = await myTool.execute({ mode: "write", data: 42 }, {} as any);
      expect(result2.output).toBe("number");
    });
  });
});
