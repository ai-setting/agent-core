/**
 * @fileoverview SSE Events Route
 * 
 * Server-Sent Events endpoint for streaming EventBus events to clients.
 * Based on OpenCode's SSE implementation using Hono.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribeGlobal } from "../eventbus/global.js";
import { subscribeToSession } from "../eventbus/bus.js";
import { sseLogger } from "../logger.js";

const app = new Hono();

// Track active connections per session to prevent duplicates
const activeConnections = new Map<string, number>();

/**
 * GET /events
 * 
 * SSE endpoint for subscribing to EventBus events.
 * 
 * Query Parameters:
 * - sessionId (optional): Filter events by session ID
 * 
 * Events:
 * - server.connected: Initial connection established
 * - server.heartbeat: Keep-alive ping (every 30s)
 * - stream.*: Stream events (text, reasoning, tool_call, etc.)
 * - server.error: Error occurred
 */
app.get("/", async (c) => {
  const sessionId = c.req.query("sessionId");
  
    // Track connection count for this session
  if (sessionId) {
    const count = activeConnections.get(sessionId) || 0;
    if (count > 0) {
      sseLogger.info("Client reconnected", { sessionId, connections: count + 1 });
    } else {
      sseLogger.info("Client connected", { sessionId });
    }
    activeConnections.set(sessionId, count + 1);
  } else {
    sseLogger.info("Client connected (no session)");
  }
  
  return streamSSE(c, async (stream) => {
    // Send initial connected event
    await stream.writeSSE({
      data: JSON.stringify({
        type: "server.connected",
        timestamp: Date.now(),
        sessionId: sessionId || null,
      }),
    });

    // Subscribe to events - use a wrapper to handle errors
    let isClosed = false;
    const unsubscribe = sessionId
      ? subscribeToSession(sessionId, async (event) => {
          if (isClosed) return;
          try {
            // Flatten event: { type, properties } -> { type, ...properties }
            const flattenedEvent = {
              type: event.type,
              ...(event.properties as object),
            };
            sseLogger.debug("Sending event to client", { sessionId, type: event.type });
            await stream.writeSSE({ 
              data: JSON.stringify(flattenedEvent) 
            });
          } catch (err) {
            // Client may have disconnected
            isClosed = true;
          }
        })
      : subscribeGlobal(async (data) => {
          if (isClosed) return;
          try {
            // Flatten event: { type, properties } -> { type, ...properties }
            const flattenedEvent = {
              type: data.payload.type,
              ...(data.payload.properties as object),
            };
            sseLogger.debug("Sending event to client", { type: data.payload.type });
            await stream.writeSSE({ 
              data: JSON.stringify(flattenedEvent) 
            });
          } catch (err) {
            // Client may have disconnected
            isClosed = true;
          }
        });

    // Send heartbeat every 5s to keep connection alive (prevent timeout)
    const heartbeat = setInterval(async () => {
      if (isClosed) return;
      try {
        await stream.writeSSE({
          data: JSON.stringify({ 
            type: "server.heartbeat",
            timestamp: Date.now(),
          }),
        });
      } catch {
        // Client disconnected
        isClosed = true;
      }
    }, 5000);

    // Wait for client disconnect
    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        isClosed = true;
        clearInterval(heartbeat);
        unsubscribe();
        
        // Update connection count
        if (sessionId) {
          const count = activeConnections.get(sessionId) || 0;
          if (count <= 1) {
            activeConnections.delete(sessionId);
          } else {
            activeConnections.set(sessionId, count - 1);
          }
        }
        
        console.log(`[SSE] Client disconnected${sessionId ? ` (session: ${sessionId})` : ""}`);
        resolve();
      });
    });
  });
});

export default app;
export { app as eventsRoute };
