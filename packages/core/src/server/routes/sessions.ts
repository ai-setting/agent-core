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
import type { MessageWithParts, TextPart } from "../../core/session/types.js";

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
 * Uses env's session: get or create session, add user message, handle_query, add assistant message.
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

  let session = await resolve(env.getSession!(id));
  if (!session) {
    sessionLogger.info("Creating new session for prompt", { sessionId: id });
    session = await resolve(env.createSession!({ id, title: "New Chat" }));
  }

  session.addUserMessage(body.content);
  sessionLogger.info("Added user message", { sessionId: session.id });

  const history = session.toHistory();
  sessionLogger.info("Starting AI processing", { sessionId: session.id, historyLength: history.length });

  env
    .handle_query(body.content, { session_id: session.id }, history)
    .then((response: string) => {
      sessionLogger.info("AI processing completed", { sessionId: session!.id, responseLength: response.length });
      session!.addAssistantMessage(response);
    })
    .catch((error: Error) => {
      sessionLogger.error("AI processing failed", { sessionId: session!.id, error: error.message });
    });

  return c.json({
    success: true,
    sessionId: session.id,
    message: "Processing started",
  });
});

export default app;
export { app as sessionsRoute };
