/**
 * @fileoverview Session Routes
 * 
 * REST API for session management.
 */

import { Hono } from "hono";
import { sessionManager } from "../session.js";
import type { ServerEnvironment } from "../environment.js";

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
  const body = await c.req.json<{ title?: string }>();
  const session = sessionManager.create(body?.title);
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
  
  if (!body?.content) {
    return c.json({ error: "Content is required" }, 400);
  }
  
  // Get or create session (use client-provided ID if creating new)
  let session = sessionManager.get(id);
  if (!session) {
    session = sessionManager.create(undefined, id);
  }
  
  // Add user message
  sessionManager.addMessage(session.id, "user", body.content);
  
  // Get ServerEnvironment from context
  const env = c.get("env");
  
  if (!env) {
    return c.json({ error: "Server not configured" }, 503);
  }
  
  // Build history from session messages
  const messages = session.messages.map(m => ({
    role: m.role,
    content: { type: "text" as const, text: m.content },
  }));
  
  // Trigger async AI processing
  // The response will be streamed via SSE
  env.handle_query(body.content, { session_id: session.id }, messages)
    .then((response: string) => {
      // Add assistant response to session
      sessionManager.addMessage(session.id, "assistant", response);
    })
    .catch((error: Error) => {
      console.error("[Prompt] Error:", error);
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
