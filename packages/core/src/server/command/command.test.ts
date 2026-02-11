/**
 * @fileoverview Command 机制全面测试
 *
 * 验证 Command Registry、Commands 和类型定义
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { CommandRegistry } from "./registry.js";
import { echoCommand } from "./built-in/echo.js";
import type { Command, CommandContext, CommandResult } from "./types.js";

describe("Command System", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    // 重置单例
    (CommandRegistry as any).instance = undefined;
    registry = CommandRegistry.getInstance();
  });

  describe("CommandRegistry", () => {
    it("should be a singleton", () => {
      const instance1 = CommandRegistry.getInstance();
      const instance2 = CommandRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("should register a command", () => {
      registry.register(echoCommand);
      expect(registry.has("echo")).toBe(true);
      expect(registry.list()).toHaveLength(1);
    });

    it("should get command by name", () => {
      registry.register(echoCommand);
      const cmd = registry.get("echo");
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe("echo");
      expect(cmd?.description).toBe("Echo a message back (test command)");
    });

    it("should list command info without execute function", () => {
      registry.register(echoCommand);
      const info = registry.listInfo();
      expect(info).toHaveLength(1);
      expect(info[0].name).toBe("echo");
      expect(info[0].hasArgs).toBe(true);
      // execute 函数不应该在 info 中
      expect((info[0] as any).execute).toBeUndefined();
    });

    it("should unregister a command", () => {
      registry.register(echoCommand);
      expect(registry.has("echo")).toBe(true);

      const result = registry.unregister("echo");
      expect(result).toBe(true);
      expect(registry.has("echo")).toBe(false);
      expect(registry.list()).toHaveLength(0);
    });

    it("should return false when unregistering non-existent command", () => {
      const result = registry.unregister("non-existent");
      expect(result).toBe(false);
    });

    it("should return undefined for non-existent command", () => {
      const cmd = registry.get("non-existent");
      expect(cmd).toBeUndefined();
    });

    it("should return false for non-existent command in has()", () => {
      expect(registry.has("non-existent")).toBe(false);
    });

    it("should allow multiple commands", () => {
      const cmd1: Command = {
        name: "cmd1",
        description: "First command",
        execute: async () => ({ success: true }),
      };
      const cmd2: Command = {
        name: "cmd2",
        description: "Second command",
        execute: async () => ({ success: true }),
      };

      registry.register(cmd1);
      registry.register(cmd2);

      expect(registry.list()).toHaveLength(2);
      expect(registry.has("cmd1")).toBe(true);
      expect(registry.has("cmd2")).toBe(true);
    });

    it("should overwrite existing command when registering with same name", () => {
      const cmd1: Command = {
        name: "test",
        description: "First version",
        execute: async () => ({ success: true, message: "v1" }),
      };
      const cmd2: Command = {
        name: "test",
        description: "Second version",
        execute: async () => ({ success: true, message: "v2" }),
      };

      registry.register(cmd1);
      registry.register(cmd2);

      const retrieved = registry.get("test");
      expect(retrieved?.description).toBe("Second version");
    });

    it("should clear all commands", () => {
      registry.register(echoCommand);
      expect(registry.list()).toHaveLength(1);

      registry.clear();
      expect(registry.list()).toHaveLength(0);
      expect(registry.has("echo")).toBe(false);
    });

    it("should list empty array when no commands registered", () => {
      expect(registry.list()).toEqual([]);
      expect(registry.listInfo()).toEqual([]);
    });

    it("should preserve command properties in listInfo", () => {
      registry.register(echoCommand);
      const info = registry.listInfo()[0];

      expect(info.name).toBe("echo");
      expect(info.displayName).toBe("Echo");
      expect(info.description).toBe("Echo a message back (test command)");
      expect(info.hasArgs).toBe(true);
      expect(info.argsDescription).toBe("message to echo");
    });
  });

  describe("Echo Command", () => {
    it("should echo message with args", async () => {
      const mockEnv = {} as any;
      const result = await echoCommand.execute(
        { sessionId: "test-session", env: mockEnv },
        "hello world"
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe("Echoed: hello world");
      expect(result.data).toEqual({
        echoed: "hello world",
        sessionId: "test-session",
      });
    });

    it("should use default message when no args", async () => {
      const mockEnv = {} as any;
      const result = await echoCommand.execute(
        { sessionId: undefined, env: mockEnv },
        ""
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe("Echoed: Hello from Agent Core!");
      expect(result.data).toEqual({
        echoed: "Hello from Agent Core!",
        sessionId: undefined,
      });
    });

    it("should trim whitespace from args", async () => {
      const mockEnv = {} as any;
      const result = await echoCommand.execute(
        { sessionId: "test", env: mockEnv },
        "  hello with spaces  "
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe("Echoed: hello with spaces");
    });

    it("should handle special characters in args", async () => {
      const mockEnv = {} as any;
      const result = await echoCommand.execute(
        { sessionId: "test", env: mockEnv },
        "hello! @#$%^&*()"
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe("Echoed: hello! @#$%^&*()");
    });

    it("should handle unicode characters", async () => {
      const mockEnv = {} as any;
      const result = await echoCommand.execute(
        { sessionId: "test", env: mockEnv },
        "你好世界 🎉"
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe("Echoed: 你好世界 🎉");
    });

    it("should have correct metadata", () => {
      expect(echoCommand.name).toBe("echo");
      expect(echoCommand.displayName).toBe("Echo");
      expect(echoCommand.description).toBe("Echo a message back (test command)");
      expect(echoCommand.hasArgs).toBe(true);
      expect(echoCommand.argsDescription).toBe("message to echo");
    });
  });

  describe("Custom Commands", () => {
    it("should support command without args", async () => {
      const noArgsCommand: Command = {
        name: "status",
        description: "Show status",
        hasArgs: false,
        execute: async (ctx: CommandContext) => ({
          success: true,
          message: "Status: OK",
        }),
      };

      registry.register(noArgsCommand);
      const cmd = registry.get("status");
      expect(cmd).toBeDefined();
      expect(cmd?.hasArgs).toBe(false);

      const result = await cmd!.execute({ env: {} as any }, "");
      expect(result.success).toBe(true);
      expect(result.message).toBe("Status: OK");
    });

    it("should support command with optional displayName", async () => {
      const cmd: Command = {
        name: "test-cmd",
        description: "Test command",
        execute: async () => ({ success: true }),
      };

      expect(cmd.displayName).toBeUndefined();
      expect(cmd.name).toBe("test-cmd");
    });

    it("should support command returning data", async () => {
      const dataCommand: Command = {
        name: "data",
        description: "Return data",
        execute: async () => ({
          success: true,
          data: { key: "value", number: 42 },
        }),
      };

      const result = await dataCommand.execute({ env: {} as any }, "");
      expect(result.data).toEqual({ key: "value", number: 42 });
    });

    it("should support command returning error", async () => {
      const errorCommand: Command = {
        name: "error",
        description: "Return error",
        execute: async () => ({
          success: false,
          message: "Something went wrong",
        }),
      };

      const result = await errorCommand.execute({ env: {} as any }, "");
      expect(result.success).toBe(false);
      expect(result.message).toBe("Something went wrong");
    });

    it("should support async commands", async () => {
      let executed = false;
      const asyncCommand: Command = {
        name: "async",
        description: "Async command",
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          executed = true;
          return { success: true };
        },
      };

      const result = await asyncCommand.execute({ env: {} as any }, "");
      expect(executed).toBe(true);
      expect(result.success).toBe(true);
    });

    it("should support commands using context", async () => {
      let capturedSessionId: string | undefined;
      const contextCommand: Command = {
        name: "context",
        description: "Use context",
        execute: async (ctx: CommandContext) => {
          capturedSessionId = ctx.sessionId;
          return { success: true };
        },
      };

      await contextCommand.execute(
        { sessionId: "my-session", env: {} as any },
        ""
      );
      expect(capturedSessionId).toBe("my-session");
    });
  });
});
