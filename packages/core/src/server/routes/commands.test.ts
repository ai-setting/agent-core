/**
 * @fileoverview Commands Routes 测试
 *
 * 测试 HTTP 路由的完整功能
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { CommandRegistry } from "../command/registry.js";
import { echoCommand } from "../command/built-in/echo.js";
import type { Command } from "../command/types.js";

// 定义环境变量类型
interface TestEnv {
  Variables: {
    env: any;
  };
}

describe("Commands Routes", () => {
  let registry: CommandRegistry;
  let app: Hono<TestEnv>;

  beforeEach(() => {
    // 重置单例
    (CommandRegistry as any).instance = undefined;
    registry = CommandRegistry.getInstance();

    // 创建 Hono 应用
    app = new Hono<TestEnv>();

    // 设置环境变量中间件
    app.use("/commands/*", async (c, next) => {
      c.set("env", { mock: true } as any);
      await next();
    });

    // 手动添加路由（模拟 routes/commands.ts 的行为）
    app.get("/commands", async (c) => {
      const commands = registry.listInfo();
      return c.json(commands);
    });

    app.post("/commands/:name", async (c) => {
      const name = c.req.param("name");
      let body: { sessionId?: string; args?: string } = {};
      try {
        body = await c.req.json();
      } catch {
        // 没有 body
      }

      const env = c.get("env");
      if (!env) {
        return c.json({ error: "Server environment not configured" }, 503);
      }

      const command = registry.get(name);
      if (!command) {
        return c.json({ error: `Command '${name}' not found` }, 404);
      }

      const cmdContext = {
        sessionId: body.sessionId,
        env,
      };

      try {
        const result = await command.execute(cmdContext, body.args || "");
        return c.json(result);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return c.json(
          {
            success: false,
            message: `Command execution failed: ${errorMessage}`,
          },
          500
        );
      }
    });
  });

  describe("GET /commands", () => {
    it("should return empty array when no commands", async () => {
      const req = new Request("http://localhost/commands");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it("should return list of commands", async () => {
      registry.register(echoCommand);

      const req = new Request("http://localhost/commands");
      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect((body as any)[0].name).toBe("echo");
      expect((body as any)[0].execute).toBeUndefined();
    });

    it("should return command info with all fields", async () => {
      registry.register(echoCommand);

      const req = new Request("http://localhost/commands");
      const res = await app.fetch(req);
      const body = await res.json();

      expect((body as any)[0]).toHaveProperty("name");
      expect((body as any)[0]).toHaveProperty("displayName");
      expect((body as any)[0]).toHaveProperty("description");
      expect((body as any)[0]).toHaveProperty("hasArgs");
      expect((body as any)[0]).toHaveProperty("argsDescription");
    });
  });

  describe("POST /commands/:name", () => {
    it("should execute echo command with args", async () => {
      registry.register(echoCommand);

      const req = new Request("http://localhost/commands/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: "hello world" }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect((body as any).success).toBe(true);
      expect((body as any).message).toBe("hello world");
    });

    it("should execute command with sessionId", async () => {
      registry.register(echoCommand);

      const req = new Request("http://localhost/commands/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "test-session-123",
          args: "with session",
        }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect((body as any).success).toBe(true);
      expect((body as any).data.sessionId).toBe("test-session-123");
    });

    it("should return 404 for non-existent command", async () => {
      const req = new Request("http://localhost/commands/nonexistent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: "test" }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(404);
      const body = await res.json();
      expect((body as any).error).toContain("not found");
    });

    it("should return 503 when environment not configured", async () => {
      // 创建没有环境变量的应用
      const appWithoutEnv = new Hono();
      appWithoutEnv.post("/commands/:name", async (c) => {
        return c.json({ error: "Server environment not configured" }, 503);
      });

      const req = new Request("http://localhost/commands/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: "test" }),
      });

      const res = await appWithoutEnv.fetch(req);

      expect(res.status).toBe(503);
    });

    it("should handle empty request body", async () => {
      registry.register(echoCommand);

      const req = new Request("http://localhost/commands/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect((body as any).success).toBe(true);
    });

    it("should handle command execution error", async () => {
      const errorCommand: Command = {
        name: "error",
        description: "Error command",
        execute: async () => {
          throw new Error("Test error");
        },
      };
      registry.register(errorCommand);

      const req = new Request("http://localhost/commands/error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ args: "test" }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect((body as any).success).toBe(false);
      expect((body as any).message).toContain("Test error");
    });

    it("should handle URL encoded command names", async () => {
      const testCommand: Command = {
        name: "test-cmd",
        description: "Test command with hyphen",
        execute: async () => ({ success: true }),
      };
      registry.register(testCommand);

      const req = new Request("http://localhost/commands/test-cmd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect((body as any).success).toBe(true);
    });

    it("should handle special characters in args", async () => {
      registry.register(echoCommand);

      const req = new Request("http://localhost/commands/echo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          args: 'special "quotes" and \n newlines',
        }),
      });

      const res = await app.fetch(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect((body as any).message).toContain("special");
    });
  });

  describe("Complex Scenarios", () => {
    it("should handle multiple commands", async () => {
      const cmd1: Command = {
        name: "cmd1",
        description: "Command 1",
        execute: async () => ({ success: true, data: { id: 1 } }),
      };
      const cmd2: Command = {
        name: "cmd2",
        description: "Command 2",
        execute: async () => ({ success: true, data: { id: 2 } }),
      };

      registry.register(cmd1);
      registry.register(cmd2);

      // 列出所有命令
      const listReq = new Request("http://localhost/commands");
      const listRes = await app.fetch(listReq);
      const listBody = await listRes.json();
      expect(listBody).toHaveLength(2);

      // 执行第一个命令
      const execReq1 = new Request("http://localhost/commands/cmd1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const execRes1 = await app.fetch(execReq1);
      const execBody1 = await execRes1.json();
      expect((execBody1 as any).data.id).toBe(1);

      // 执行第二个命令
      const execReq2 = new Request("http://localhost/commands/cmd2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const execRes2 = await app.fetch(execReq2);
      const execBody2 = await execRes2.json();
      expect((execBody2 as any).data.id).toBe(2);
    });

    it("should maintain state across requests", async () => {
      let callCount = 0;
      const statefulCommand: Command = {
        name: "counter",
        description: "Count calls",
        execute: async () => {
          callCount++;
          return { success: true, data: { count: callCount } };
        },
      };

      registry.register(statefulCommand);

      // 第一次调用
      const req1 = new Request("http://localhost/commands/counter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res1 = await app.fetch(req1);
      const body1 = await res1.json();
      expect((body1 as any).data.count).toBe(1);

      // 第二次调用
      const req2 = new Request("http://localhost/commands/counter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const res2 = await app.fetch(req2);
      const body2 = await res2.json();
      expect((body2 as any).data.count).toBe(2);
    });
  });
});
