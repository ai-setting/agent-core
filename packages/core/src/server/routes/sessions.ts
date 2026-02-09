/**
 * @fileoverview Session Routes
 * 
 * REST API for session management.
 */

import { Hono } from "hono";
import { sessionManager } from "../session.js";
import type { ServerEnvironment } from "../environment.js";
import { sessionLogger } from "../logger.js";

interface Env {
  Variables: {
    env: ServerEnvironment;
  };
}

const app = new Hono<Env>();

/**
 * GET /sessions - List all sessions
 */
app.get("/", (c) => {
  const sessions = sessionManager.list();
  return c.json(sessions);
});

/**
 * POST /sessions - Create new session
 */
app.post("/", async (c) => {
  let title: string | undefined;
  try {
    const body = await c.req.json<{ title?: string }>();
    title = body?.title;
  } catch {
    // Request body is empty or invalid JSON, that's okay
    title = undefined;
  }
  const session = sessionManager.create(title);
  return c.json(session, 201);
});

/**
 * GET /sessions/:id - Get session details
 */
app.get("/:id", (c) => {
  const id = c.req.param("id");
  const session = sessionManager.get(id);
  
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  
  return c.json(session);
});

/**
 * DELETE /sessions/:id - Delete session
 */
app.delete("/:id", (c) => {
  const id = c.req.param("id");
  const deleted = sessionManager.delete(id);
  
  if (!deleted) {
    return c.json({ error: "Session not found" }, 404);
  }
  
  return c.json({ success: true });
});

/**
 * GET /sessions/:id/messages - Get session messages
 */
app.get("/:id/messages", (c) => {
  const id = c.req.param("id");
  const session = sessionManager.get(id);
  
  if (!session) {
    return c.json({ error: "Session not found" }, 404);
  }
  
  return c.json(session.messages);
});

/**
 * POST /sessions/:id/prompt - Send prompt to AI
 * 
 * This endpoint triggers AI processing. The response
 * is streamed via SSE to connected clients.
 */
app.post("/:id/prompt", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ content: string }>();
  
  sessionLogger.info("Received prompt request", { sessionId: id, contentLength: body?.content?.length });
  
  if (!body?.content) {
    sessionLogger.warn("Prompt request missing content", { sessionId: id });
    return c.json({ error: "Content is required" }, 400);
  }
  
  // Get or create session (use client-provided ID if creating new)
  let session = sessionManager.get(id);
  if (!session) {
    sessionLogger.info("Creating new session for prompt", { sessionId: id });
    session = sessionManager.create(undefined, id);
  }
  
  // Add user message
  sessionManager.addMessage(session.id, "user", body.content);
  sessionLogger.info("Added user message", { sessionId: session.id, messageCount: session.messages.length });
  
  // Get ServerEnvironment from context
  const env = c.get("env");
  
  if (!env) {
    sessionLogger.error("Server environment not configured");
    return c.json({ error: "Server not configured" }, 503);
  }
  
  // Build history from session messages
  const messages = session.messages.map(m => ({
    role: m.role,
    content: { type: "text" as const, text: m.content },
  }));
  
  sessionLogger.info("Starting AI processing", { sessionId: session.id, historyLength: messages.length });
  
  // Trigger async AI processing
  // The response will be streamed via SSE
  env.handle_query(body.content, { session_id: session.id }, messages)
    .then((response: string) => {
      sessionLogger.info("AI processing completed", { sessionId: session.id, responseLength: response.length });
      // Add assistant response to session
      sessionManager.addMessage(session.id, "assistant", response);
    })
    .catch((error: Error) => {
      sessionLogger.error("AI processing failed", { sessionId: session.id, error: error.message });
    });
  
  // Return immediately - client will receive stream via SSE
  return c.json({ 
    success: true, 
    sessionId: session.id,
    message: "Processing started" 
  });
});

export default app;
export { app as sessionsRoute };
