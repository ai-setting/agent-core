/**
 * @fileoverview Session Routes
 *
 * REST API for session management. Uses the Environment's session capability
 * (createSession / getSession / listSessions / updateSession / deleteSession)
 * when available; returns 503 when env has no session support.
 */

import { Hono } from "hono";
import type { ServerEnvironment } from "../environment.js";
import { sessionLogger } from "../logger.js";
import type { Session } from "../../core/session/index.js";
import { sessionAbortManager } from "../../core/session/abort-manager.js";
import type { MessageWithParts, TextPart } from "../../core/session/types.js";
import { EventTypes, type EnvEvent } from "../../core/types/event.js";

interface Env {
  Variables: {
    env: ServerEnvironment;
  };
}

const app = new Hono<Env>();

function hasSessionSupport(env: ServerEnvironment): boolean {
  return (
    typeof env.createSession === "function" &&
    typeof env.getSession === "function" &&
    typeof env.listSessions === "function" &&
    typeof env.updateSession === "function" &&
    typeof env.deleteSession === "function"
  );
}

async function ensureSessionEnv(c: any): Promise<ServerEnvironment | null> {
  const env = c.get("env") as ServerEnvironment | undefined;
  if (!env) {
    sessionLogger.warn("Session route: server env not configured");
    return null;
  }
  if (!hasSessionSupport(env)) {
    sessionLogger.warn("Session route: env has no session support");
    return null;
  }
  return env;
}

/** Resolve optional promise from env method */
async function resolve<T>(v: T | Promise<T>): Promise<T> {
  return Promise.resolve(v);
}

/** Convert core Session to REST list/get summary shape */
function sessionToSummary(session: Session): { id: string; title: string; createdAt: number; updatedAt: number } {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

/** Extract plain text from MessageWithParts for REST messages array */
function messageToSimple(msg: MessageWithParts): { id: string; role: string; content: string; timestamp: number } {
  const parts = msg.parts || [];
  const content = parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n") || "";
  return {
    id: msg.info.id,
    role: msg.info.role,
    content,
    timestamp: msg.info.timestamp,
  };
}

/**
 * GET /sessions - List all sessions
 */
app.get("/", async (c) => {
  const env = await ensureSessionEnv(c);
  if (!env) return c.json({ error: "Session support not available" }, 503);

  const list = await resolve(env.listSessions!());
  const sessions = list.map(sessionToSummary).sort((a, b) => b.updatedAt - a.updatedAt);
  return c.json(sessions);
});

/**
 * POST /sessions - Create new session
 */
app.post("/", async (c) => {
  const env = await ensureSessionEnv(c);
  if (!env) return c.json({ error: "Session support not available" }, 503);

  let title: string | undefined;
  try {
    const body = await c.req.json<{ title?: string }>();
    title = body?.title;
  } catch {
    title = undefined;
  }
  const session = await resolve(env.createSession!({ title }));
  
  // 设置 Active Session
  const clientId = process.env.CLIENT_ID;
  if (clientId) {
    env.getActiveSessionManager().setActiveSession(clientId, session.id);
  }
  
  return c.json(sessionToSummary(session), 201);
});

/**
 * GET /sessions/:id - Get session details
 */
app.get("/:id", async (c) => {
  const env = await ensureSessionEnv(c);
  if (!env) return c.json({ error: "Session support not available" }, 503);

  const id = c.req.param("id");
  const session = await resolve(env.getSession!(id));
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json(sessionToSummary(session));
});

/**
 * DELETE /sessions/:id - Delete session
 */
app.delete("/:id", async (c) => {
  const env = await ensureSessionEnv(c);
  if (!env) return c.json({ error: "Session support not available" }, 503);

  const id = c.req.param("id");
  const session = await resolve(env.getSession!(id));
  if (!session) return c.json({ error: "Session not found" }, 404);
  await resolve(env.deleteSession!(id));
  return c.json({ success: true });
});

/**
 * GET /sessions/:id/messages - Get session messages
 */
app.get("/:id/messages", async (c) => {
  const env = await ensureSessionEnv(c);
  if (!env) return c.json({ error: "Session support not available" }, 503);

  const id = c.req.param("id");
  const session = await resolve(env.getSession!(id));
  if (!session) return c.json({ error: "Session not found" }, 404);
  const messages = session.getMessages().map(messageToSimple);
  return c.json(messages);
});

/**
 * POST /sessions/:id/prompt - Send prompt to AI
 *
 * Produces user_query event, let EventBus handle it.
 * Note: This endpoint returns immediately without waiting for the full agent execution.
 * The agent runs asynchronously in the background and sends events via SSE.
 */
app.post("/:id/prompt", async (c) => {
  const env = await ensureSessionEnv(c);
  if (!env) return c.json({ error: "Session support not available" }, 503);

  const id = c.req.param("id");
  const body = await c.req.json<{ content: string }>();

  sessionLogger.info("Received prompt request", { sessionId: id, contentLength: body?.content?.length });

  if (!body?.content) {
    sessionLogger.warn("Prompt request missing content", { sessionId: id });
    return c.json({ error: "Content is required" }, 400);
  }

  const event: EnvEvent<{ sessionId: string; content: string }> = {
    id: crypto.randomUUID(),
    type: EventTypes.USER_QUERY,
    timestamp: Date.now(),
    metadata: {
      trigger_session_id: id,
      source: "user"
    },
    payload: {
      sessionId: id,
      content: body.content
    }
  };

  // Fire and forget - don't await, let the agent run asynchronously
  // Events will be streamed back via SSE connection
  env.publishEvent(event).catch((err) => {
    sessionLogger.error("Failed to publish event", { sessionId: id, error: err.message });
  });

  return c.json({
    success: true,
    sessionId: id,
    message: "Processing started",
  });
});

/**
 * POST /sessions/:id/interrupt - Interrupt a running session
 */
app.post("/:id/interrupt", async (c) => {
  const env = await ensureSessionEnv(c);
  if (!env) return c.json({ error: "Session support not available" }, 503);

  const id = c.req.param("id");
  
  if (sessionAbortManager.has(id)) {
    sessionAbortManager.abort(id);
    
    // Stop all background tasks for this session
    const stoppedTasks = env.stopBackgroundTasksForSession(id);
    
    sessionLogger.info("Session interrupted", { 
      sessionId: id,
      stoppedBackgroundTasks: stoppedTasks
    });
    
    return c.json({ 
      success: true, 
      interrupted: true,
      stoppedBackgroundTasks: stoppedTasks
    });
  }
  
  return c.json({ success: true, interrupted: false });
});

export default app;
export { app as sessionsRoute };
