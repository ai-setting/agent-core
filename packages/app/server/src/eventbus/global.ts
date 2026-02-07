/**
 * @fileoverview GlobalBus - Cross-instance event emitter
 * 
 * Used for broadcasting events across all sessions and to SSE clients.
 * Based on Node.js EventEmitter.
 */

import { EventEmitter } from "events";

/**
 * Global event emitter for cross-instance communication
 * 
 * Events emitted here will be received by all instances,
 * making it ideal for SSE broadcasting.
 */
export const GlobalBus = new EventEmitter<{
  event: [
    {
      sessionId?: string;
      payload: {
        type: string;
        properties: unknown;
      };
    }
  ];
}>();

/**
 * Publish event to GlobalBus
 */
export function publishGlobal(
  sessionId: string | undefined,
  type: string,
  properties: unknown
): void {
  GlobalBus.emit("event", {
    sessionId,
    payload: { type, properties },
  });
}

/**
 * Subscribe to all global events
 */
export function subscribeGlobal(
  callback: (data: {
    sessionId?: string;
    payload: { type: string; properties: unknown };
  }) => void
): () => void {
  GlobalBus.on("event", callback);
  return () => GlobalBus.off("event", callback);
}
