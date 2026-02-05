/**
 * @fileoverview Unit tests for OsEnv simplified initialization.
 * Tests auto-registration of OS tools and auto-configuration of LLM.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { OsEnv, createBashTool, createFileTools, createOsTools } from "../../src/environment/expand_env/os-env.js";
import type { Tool, Context } from "../../src/types/index.js";

describe("OsEnv Simplified Initialization", () => {
  describe("constructor with default tools", () => {
    test("should auto-register bash tool when created", () => {
      const env = new OsEnv();

      const tools = env.listTools();
      const bashTool = tools.find((t) => t.name === "bash");

      expect(bashTool).toBeDefined();
      expect(bashTool?.name).toBe("bash");
    });

    test("should auto-register file operation tools", () => {
      const env = new OsEnv();

      const tools = env.listTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("write_file");
      expect(toolNames).toContain("glob");
      expect(toolNames).toContain("grep");
    });

    test("should register exactly 5 OS tools by default", () => {
      const env = new OsEnv();

      const tools = env.listTools();

      expect(tools.length).toBe(5);
    });

    test("should allow manual registration of additional tools", () => {
      const env = new OsEnv();

      const customTool: Tool = {
        name: "custom_tool",
        description: "A custom tool",
        parameters: {} as any,
        execute: async () => ({ success: true, output: "done" }),
      };

      env.registerTool(customTool);

      const tools = env.listTools();
      expect(tools.length).toBe(6);
      expect(tools.find((t) => t.name === "custom_tool")).toBeDefined();
    });
  });

  describe("constructor with system prompt", () => {
    test("should set system prompt when provided", () => {
      const systemPrompt = "You are a helpful assistant.";
      const env = new OsEnv({ systemPrompt });

      const prompt = env.getPrompt("system");

      expect(prompt).toBeDefined();
      expect(prompt?.content).toBe(systemPrompt);
    });

    test("should not create system prompt when not provided", () => {
      const env = new OsEnv();

      const prompt = env.getPrompt("system");

      expect(prompt).toBeUndefined();
    });
  });

  describe("constructor with workdir", () => {
    test("should set working directory when provided", () => {
      const env = new OsEnv({ workdir: "/home/user" });

      expect(env.getWorkdir()).toBe("/home/user");
    });

    test("should use process.cwd() when workdir not provided", () => {
      const env = new OsEnv();

      expect(env.getWorkdir()).toBe(process.cwd());
    });

    test("should allow changing workdir", () => {
      const env = new OsEnv();
      env.setWorkdir("/new/path");

      expect(env.getWorkdir()).toBe("/new/path");
    });
  });

  describe("constructor with environment variables", () => {
    test("should set environment variables when provided", () => {
      const env = new OsEnv({
        envVars: { TEST_VAR: "test_value" },
      });

      expect(env.getEnvVar("TEST_VAR")).toBe("test_value");
    });

    test("should fallback to process.env when variable not set", () => {
      const env = new OsEnv();

      const path = env.getEnvVar("PATH");
      expect(path).toBeDefined();
    });

    test("should allow unsetting environment variables", () => {
      const env = new OsEnv({
        envVars: { TEMP_VAR: "temp" },
      });

      env.unsetEnvVar("TEMP_VAR");

      expect(env.getEnvVar("TEMP_VAR")).toBeUndefined();
    });
  });

  describe("handle_query", () => {
    test("should handle query without LLM configured", async () => {
      const env = new OsEnv();

      const context: Context = { session_id: "test-session" };

      await expect(env.handle_query("hello", context)).rejects.toThrow();
    });
  });

  describe("getAllEnvVars", () => {
    test("should return merged environment variables", () => {
      const env = new OsEnv({
        envVars: { CUSTOM_VAR: "custom" },
      });

      const allVars = env.getAllEnvVars();

      expect(allVars.CUSTOM_VAR).toBe("custom");
      expect(allVars.PATH).toBeDefined();
    });
  });

  describe("resolvePath", () => {
    test("should resolve relative paths", () => {
      const env = new OsEnv({ workdir: "/home/user" });

      const resolved = env.resolvePath("test/file.txt");

      expect(resolved).toBe("/home/user/test/file.txt");
    });

    test("should keep absolute paths unchanged", () => {
      const env = new OsEnv({ workdir: "/home/user" });

      const resolved = env.resolvePath("/absolute/path.txt");

      expect(resolved).toBe("/absolute/path.txt");
    });
  });

  describe("isPathSafe", () => {
    test("should return true for paths within workdir", () => {
      const env = new OsEnv({ workdir: "/home/user" });

      expect(env.isPathSafe("/home/user/file.txt")).toBe(true);
    });

    test("should return false for paths outside workdir", () => {
      const env = new OsEnv({ workdir: "/home/user" });

      expect(env.isPathSafe("/etc/passwd")).toBe(false);
    });
  });

  describe("backward compatibility", () => {
    test("should work with empty config", () => {
      const env = new OsEnv();

      expect(env).toBeDefined();
      expect(env.listTools().length).toBeGreaterThan(0);
    });

    test("should allow handling actions without LLM", async () => {
      const env = new OsEnv();

      const context: Context = { session_id: "test" };

      const result = await env.handle_action(
        {
          action_id: "test",
          tool_name: "bash",
          args: { command: "echo hello" },
        },
        context
      );

      expect(result.success).toBe(true);
      expect(result.output).toContain("hello");
    });
  });
});

describe("createOsTools", () => {
  test("should create exactly 5 tools", () => {
    const tools = createOsTools();

    expect(tools.length).toBe(5);
  });

  test("should include bash tool", () => {
    const tools = createOsTools();
    const bashTool = tools.find((t) => t.name === "bash");

    expect(bashTool).toBeDefined();
    expect(bashTool?.description).toContain("bash");
  });

  test("should include file tools", () => {
    const tools = createOsTools();

    expect(tools.find((t) => t.name === "read_file")).toBeDefined();
    expect(tools.find((t) => t.name === "write_file")).toBeDefined();
    expect(tools.find((t) => t.name === "glob")).toBeDefined();
    expect(tools.find((t) => t.name === "grep")).toBeDefined();
  });
});

describe("createBashTool", () => {
  test("should create bash tool with correct properties", () => {
    const tool = createBashTool();

    expect(tool.name).toBe("bash");
    expect(tool.description).toContain("bash");
    expect(tool.parameters).toBeDefined();
    expect(typeof tool.execute).toBe("function");
  });
});

describe("createFileTools", () => {
  test("should create exactly 4 file tools", () => {
    const tools = createFileTools();

    expect(tools.length).toBe(4);
  });

  test("should include read_file tool", () => {
    const tools = createFileTools();
    const readTool = tools.find((t) => t.name === "read_file");

    expect(readTool).toBeDefined();
    expect(readTool?.description).toMatch(/[Rr]ead/);
  });

  test("should include write_file tool", () => {
    const tools = createFileTools();
    const writeTool = tools.find((t) => t.name === "write_file");

    expect(writeTool).toBeDefined();
    expect(writeTool?.description).toMatch(/[Ww]rite/);
  });
});
