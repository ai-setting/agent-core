/**
 * @fileoverview Session Interrupt Route Tests
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { sessionAbortManager } from "../../core/session/abort-manager.js";

interface TestEnv {
  Variables: {
    env: any;
  };
}

interface ResponseBody {
  success: boolean;
  interrupted: boolean;
}

describe("Session Interrupt Route", () => {
  let app: Hono<TestEnv>;

  beforeEach(() => {
    // 清理所有 session
    sessionAbortManager.abort("test-session-1");
    sessionAbortManager.abort("test-session-2");
    sessionAbortManager.abort("test-session-3");
    
    // 创建 Hono 应用
    app = new Hono<TestEnv>();
    
    // Mock env with session support
    app.use("/sessions/*", async (c, next) => {
      c.set("env", {
        createSession: async () => ({ id: "test-session-1", title: "Test" }),
        getSession: (id: string) => id ? { id, title: "Test" } : null,
        listSessions: async () => [],
        updateSession: async () => {},
        deleteSession: async () => {},
        publishEvent: async () => {},
      });
      await next();
    });
    
    // 添加 interrupt 路由（从 sessions.ts 复制的逻辑）
    app.post("/sessions/:id/interrupt", async (c) => {
      const id = c.req.param("id");
      
      if (sessionAbortManager.has(id)) {
        sessionAbortManager.abort(id);
        return c.json({ success: true, interrupted: true });
      }
      
      return c.json({ success: true, interrupted: false });
    });
  });

  describe("POST /sessions/:id/interrupt", () => {
    it("should return interrupted: false for non-existent session", async () => {
      const res = await app.request("/sessions/nonexistent/interrupt", {
        method: "POST",
      });
      
      expect(res.status).toBe(200);
      const body = await res.json() as ResponseBody;
      expect(body.success).toBe(true);
      expect(body.interrupted).toBe(false);
    });

    it("should return interrupted: true after aborting session", async () => {
      // 先创建 session
      sessionAbortManager.create("test-session-1");
      expect(sessionAbortManager.has("test-session-1")).toBe(true);
      
      // 中断 session
      const res = await app.request("/sessions/test-session-1/interrupt", {
        method: "POST",
      });
      
      expect(res.status).toBe(200);
      const body = await res.json() as ResponseBody;
      expect(body.success).toBe(true);
      expect(body.interrupted).toBe(true);
      expect(sessionAbortManager.has("test-session-1")).toBe(false);
    });

    it("should return interrupted: false when session not running", async () => {
      // session 已不存在
      const res = await app.request("/sessions/test-session-2/interrupt", {
        method: "POST",
      });
      
      expect(res.status).toBe(200);
      const body = await res.json() as ResponseBody;
      expect(body.success).toBe(true);
      expect(body.interrupted).toBe(false);
    });

    it("should handle multiple sessions correctly", async () => {
      // 创建多个 session
      sessionAbortManager.create("test-session-1");
      sessionAbortManager.create("test-session-2");
      sessionAbortManager.create("test-session-3");
      
      // 中断其中一个
      const res = await app.request("/sessions/test-session-2/interrupt", {
        method: "POST",
      });
      
      const body = await res.json() as ResponseBody;
      expect(body.interrupted).toBe(true);
      
      // 其他 session 应该还在
      expect(sessionAbortManager.has("test-session-1")).toBe(true);
      expect(sessionAbortManager.has("test-session-3")).toBe(true);
    });
  });
});
