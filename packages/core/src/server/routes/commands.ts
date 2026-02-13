/**
 * @fileoverview Commands Routes - Command HTTP 路由
 *
 * 提供 Command 查询和执行 API
 */

import { Hono } from "hono";
import type { ServerEnvironment } from "../environment.js";
import { CommandRegistry } from "../command/index.js";
import { serverLogger } from "../logger.js";

interface Env {
  Variables: {
    env: ServerEnvironment;
  };
}

const app = new Hono<Env>();

/**
 * GET /commands - 获取所有可用 commands
 *
 * Response: CommandInfo[]
 */
app.get("/", async (c) => {
  try {
    const registry = CommandRegistry.getInstance();
    const commands = registry.listInfo();

    serverLogger.debug("[Commands Route] List commands", { count: commands.length });
    return c.json(commands);
  } catch (error) {
    serverLogger.error("[Commands Route] Failed to list commands", { error: String(error) });
    return c.json({ error: "Failed to list commands" }, 500);
  }
});

/**
 * POST /commands/:name - 执行指定 command
 *
 * Request Body: { sessionId?: string; args?: string }
 * Response: CommandResult
 */
app.post("/:name", async (c) => {
  const name = c.req.param("name");

  try {
    // 获取请求体
    let body: { sessionId?: string; args?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      // 没有 body 或 body 解析失败，使用空对象
    }

    const env = c.get("env");

    if (!env) {
      serverLogger.error("[Commands Route] ServerEnvironment not available");
      return c.json({ error: "Server environment not configured" }, 503);
    }

    // 获取 command
    const registry = CommandRegistry.getInstance();
    const command = registry.get(name);

    if (!command) {
      serverLogger.warn("[Commands Route] Command not found", { name });
      return c.json({ error: `Command '${name}' not found` }, 404);
    }

    serverLogger.info("[Commands Route] Executing command", {
      name,
      sessionId: body.sessionId,
      hasArgs: !!body.args,
    });

    // 创建 command context
    const cmdContext = {
      sessionId: body.sessionId,
      env,
    };

    // 执行 command
    const result = await command.execute(cmdContext, body.args || "");

    serverLogger.info("[Commands Route] Command executed", {
      name,
      success: result.success,
    });

    return c.json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    serverLogger.error("[Commands Route] Command execution failed", {
      name,
      error: errorMessage,
    });

    return c.json(
      {
        success: false,
        message: `Command execution failed: ${errorMessage}`,
      },
      500
    );
  }
});

export default app;
export { app as commandsRoute };
