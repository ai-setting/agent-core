/**
 * @fileoverview Command 系统集成测试
 *
 * 测试端到端的工作流程
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { CommandRegistry } from "./registry.js";
import { echoCommand } from "./built-in/echo.js";
import type { Command, CommandContext, CommandResult } from "./types.js";

describe("Command System Integration", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    // 重置单例
    (CommandRegistry as any).instance = undefined;
    registry = CommandRegistry.getInstance();
  });

  describe("End-to-End Workflow", () => {
    it("should complete full command lifecycle", async () => {
      // 1. 注册命令
      registry.register(echoCommand);
      expect(registry.has("echo")).toBe(true);

      // 2. 获取命令列表
      const commands = registry.listInfo();
      expect(commands).toHaveLength(1);
      expect(commands[0].name).toBe("echo");

      // 3. 执行命令
      const command = registry.get("echo");
      expect(command).toBeDefined();

      const result = await command!.execute(
        { sessionId: "test-session", env: {} as any },
        "integration test"
      );

      // 4. 验证结果
      expect(result.success).toBe(true);
      expect(result.message).toBe("integration test");
      expect(result.data).toEqual({
        echoed: "integration test",
        sessionId: "test-session",
        mode: "direct",
      });
    });

    it("should handle multiple command registrations", async () => {
      // 注册多个命令
      const commands: Command[] = [
        {
          name: "cmd-a",
          description: "Command A",
          execute: async () => ({ success: true, data: { type: "a" } }),
        },
        {
          name: "cmd-b",
          description: "Command B",
          execute: async () => ({ success: true, data: { type: "b" } }),
        },
        {
          name: "cmd-c",
          description: "Command C",
          execute: async () => ({ success: true, data: { type: "c" } }),
        },
      ];

      for (const cmd of commands) {
        registry.register(cmd);
      }

      // 验证所有命令都已注册
      expect(registry.list()).toHaveLength(3);
      expect(registry.has("cmd-a")).toBe(true);
      expect(registry.has("cmd-b")).toBe(true);
      expect(registry.has("cmd-c")).toBe(true);

      // 执行每个命令
      for (const cmd of commands) {
        const registeredCmd = registry.get(cmd.name);
        const result = await registeredCmd!.execute(
          { env: {} as any },
          ""
        );
        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty("type");
      }
    });

    it("should handle command replacement workflow", async () => {
      // 注册初始版本
      const v1: Command = {
        name: "versioned",
        description: "Version 1",
        execute: async () => ({ success: true, message: "v1" }),
      };
      registry.register(v1);

      const result1 = await registry.get("versioned")!.execute(
        { env: {} as any },
        ""
      );
      expect(result1.message).toBe("v1");

      // 替换为新版本
      const v2: Command = {
        name: "versioned",
        description: "Version 2",
        execute: async () => ({ success: true, message: "v2" }),
      };
      registry.register(v2);

      const result2 = await registry.get("versioned")!.execute(
        { env: {} as any },
        ""
      );
      expect(result2.message).toBe("v2");
    });
  });

  describe("Session Management", () => {
    it("should handle global execution (no session)", async () => {
      registry.register(echoCommand);

      const result = await registry.get("echo")!.execute(
        { sessionId: undefined, env: {} as any },
        "global execution"
      );

      expect(result.success).toBe(true);
      expect((result.data as any).sessionId).toBeUndefined();
    });

    it("should handle different sessions", async () => {
      let capturedSessions: (string | undefined)[] = [];

      const sessionCommand: Command = {
        name: "session-tracker",
        description: "Track sessions",
        execute: async (ctx: CommandContext) => {
          capturedSessions.push(ctx.sessionId);
          return { success: true, data: { sessionId: ctx.sessionId } };
        },
      };

      registry.register(sessionCommand);

      // 在不同 session 中执行
      await registry.get("session-tracker")!.execute(
        { sessionId: "session-1", env: {} as any },
        ""
      );
      await registry.get("session-tracker")!.execute(
        { sessionId: "session-2", env: {} as any },
        ""
      );
      await registry.get("session-tracker")!.execute(
        { sessionId: undefined, env: {} as any },
        ""
      );

      expect(capturedSessions).toEqual(["session-1", "session-2", undefined]);
    });
  });

  describe("Error Handling", () => {
    it("should handle missing command gracefully", () => {
      const cmd = registry.get("nonexistent");
      expect(cmd).toBeUndefined();
      expect(registry.has("nonexistent")).toBe(false);
    });

    it("should handle command execution failure", async () => {
      const failingCommand: Command = {
        name: "failing",
        description: "Always fails",
        execute: async () => {
          throw new Error("Intentional failure");
        },
      };

      registry.register(failingCommand);

      try {
        await registry.get("failing")!.execute({ env: {} as any }, "");
        expect(false).toBe(true); // 不应该执行到这里
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Intentional failure");
      }
    });

    it("should handle async command timeout", async () => {
      const slowCommand: Command = {
        name: "slow",
        description: "Slow command",
        execute: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return { success: true };
        },
      };

      registry.register(slowCommand);

      const startTime = Date.now();
      const result = await registry.get("slow")!.execute(
        { env: {} as any },
        ""
      );
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(endTime - startTime).toBeGreaterThanOrEqual(50);
    });
  });

  describe("Data Flow", () => {
    it("should pass data through command execution", async () => {
      const dataCollector: any[] = [];

      const collectorCommand: Command = {
        name: "collector",
        description: "Collect data",
        execute: async (ctx: CommandContext, args: string) => {
          dataCollector.push({
            sessionId: ctx.sessionId,
            args,
            timestamp: Date.now(),
          });
          return { success: true, data: { count: dataCollector.length } };
        },
      };

      registry.register(collectorCommand);

      await registry.get("collector")!.execute(
        { sessionId: "s1", env: {} as any },
        "first"
      );
      await registry.get("collector")!.execute(
        { sessionId: "s2", env: {} as any },
        "second"
      );

      expect(dataCollector).toHaveLength(2);
      expect(dataCollector[0].sessionId).toBe("s1");
      expect(dataCollector[0].args).toBe("first");
      expect(dataCollector[1].sessionId).toBe("s2");
      expect(dataCollector[1].args).toBe("second");
    });

    it("should return structured results", async () => {
      const complexCommand: Command = {
        name: "complex",
        description: "Return complex data",
        execute: async () => ({
          success: true,
          message: "Operation completed",
          data: {
            nested: {
              array: [1, 2, 3],
              object: { key: "value" },
              boolean: true,
              number: 42,
            },
          },
        }),
      };

      registry.register(complexCommand);

      const result = await registry.get("complex")!.execute(
        { env: {} as any },
        ""
      );

      expect(result.success).toBe(true);
      expect((result.data as any).nested.array).toEqual([1, 2, 3]);
      expect((result.data as any).nested.object.key).toBe("value");
      expect((result.data as any).nested.boolean).toBe(true);
      expect((result.data as any).nested.number).toBe(42);
    });
  });

  describe("Type Safety", () => {
    it("should maintain type safety for command results", async () => {
      registry.register(echoCommand);

      const result: CommandResult = await registry.get("echo")!.execute(
        { env: {} as any },
        "typed"
      );

      // 验证类型定义的结构
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.message).toBe("string");
      expect(result.data).toBeDefined();
    });

    it("should handle optional fields correctly", async () => {
      const minimalCommand: Command = {
        name: "minimal",
        description: "Minimal command",
        execute: async () => ({ success: true }),
      };

      registry.register(minimalCommand);

      const result = await registry.get("minimal")!.execute(
        { env: {} as any },
        ""
      );

      expect(result.success).toBe(true);
      expect(result.message).toBeUndefined();
      expect(result.data).toBeUndefined();
    });
  });

  describe("Performance", () => {
    it("should handle rapid command registration", () => {
      const startTime = Date.now();

      // 快速注册 100 个命令
      for (let i = 0; i < 100; i++) {
        registry.register({
          name: `cmd-${i}`,
          description: `Command ${i}`,
          execute: async () => ({ success: true }),
        });
      }

      const endTime = Date.now();

      expect(registry.list()).toHaveLength(100);
      expect(endTime - startTime).toBeLessThan(100); // 应该很快
    });

    it("should handle rapid command execution", async () => {
      registry.register(echoCommand);

      const startTime = Date.now();

      // 快速执行 50 次
      const promises = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          registry.get("echo")!.execute({ env: {} as any }, `test-${i}`)
        );
      }

      const results = await Promise.all(promises);

      const endTime = Date.now();

      expect(results).toHaveLength(50);
      expect(results.every((r) => r.success)).toBe(true);
      expect(endTime - startTime).toBeLessThan(500); // 应该很快
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty command name", async () => {
      const emptyNameCommand: Command = {
        name: "",
        description: "Empty name",
        execute: async () => ({ success: true }),
      };

      registry.register(emptyNameCommand);

      const cmd = registry.get("");
      expect(cmd).toBeDefined();
      expect(cmd?.description).toBe("Empty name");
    });

    it("should handle very long args", async () => {
      registry.register(echoCommand);

      const longArg = "x".repeat(10000);
      const result = await registry.get("echo")!.execute(
        { env: {} as any },
        longArg
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain(longArg);
    });

    it("should handle special characters in command names", async () => {
      const specialCommands: Command[] = [
        {
          name: "cmd-with-dash",
          description: "Dash",
          execute: async () => ({ success: true }),
        },
        {
          name: "cmd_with_underscore",
          description: "Underscore",
          execute: async () => ({ success: true }),
        },
        {
          name: "cmd.with.dot",
          description: "Dot",
          execute: async () => ({ success: true }),
        },
        {
          name: "cmd:with:colon",
          description: "Colon",
          execute: async () => ({ success: true }),
        },
      ];

      for (const cmd of specialCommands) {
        registry.register(cmd);
        expect(registry.has(cmd.name)).toBe(true);

        const result = await registry.get(cmd.name)!.execute(
          { env: {} as any },
          ""
        );
        expect(result.success).toBe(true);
      }
    });

    it("should handle concurrent registrations", async () => {
      const commands: Command[] = Array.from({ length: 20 }, (_, i) => ({
        name: `concurrent-${i}`,
        description: `Concurrent command ${i}`,
        execute: async () => ({ success: true, data: { index: i } }),
      }));

      // 并发注册
      await Promise.all(commands.map((cmd) => registry.register(cmd)));

      expect(registry.list()).toHaveLength(20);

      // 验证每个命令
      for (let i = 0; i < 20; i++) {
        const cmd = registry.get(`concurrent-${i}`);
        expect(cmd).toBeDefined();
      }
    });
  });
});
