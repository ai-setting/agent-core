/**
 * @fileoverview Bus - Main event bus implementation
 * 
 * Provides publish/subscribe functionality for type-safe events.
 * Supports session-scoped subscriptions and global broadcasts.
 * 
 * Based on OpenCode's Bus pattern.
 */

import type { ZodType } from "zod";
import type { EventDefinition, EventPayload } from "./bus-event.js";
import { publishGlobal, subscribeGlobal } from "./global.js";

/**
 * Subscription function type
 */
type Subscription = (event: any) => void | Promise<void>;

/**
 * Session-scoped state
 */
interface SessionState {
  subscriptions: Map<string, Subscription[]>;
}

/**
 * Global state map for all sessions
 */
const state = new Map<string, SessionState>();

/**
 * Default session ID for non-session events
 */
const DEFAULT_SESSION = "default";

/**
 * Get or create session state
 */
function getSessionState(sessionId: string = DEFAULT_SESSION): SessionState {
  if (!state.has(sessionId)) {
    state.set(sessionId, {
      subscriptions: new Map(),
    });
  }
  return state.get(sessionId)!;
}

/**
 * Publish an event to all subscribers
 * 
 * @param definition - Event definition from BusEvent.define()
 * @param properties - Event payload (validated by Zod schema)
 * @param sessionId - Optional session ID for scoping
 * 
 * @example
 * ```typescript
 * await Bus.publish(StreamTextEvent, {
 *   sessionId: "abc",
 *   messageId: "msg1",
 *   content: "Hello",
 *   delta: "Hello"
 * });
 * ```
 */
export async function publish<Def extends EventDefinition>(
  definition: Def,
  properties: Def["properties"] extends ZodType<infer T> ? T : never,
  sessionId?: string
): Promise<void> {
  const payload = {
    type: definition.type,
    properties,
  };

  console.log("[Bus] Publishing:", { type: definition.type, sessionId });

  const pending: (void | Promise<void>)[] = [];
  const sessionState = getSessionState(sessionId);

  // Subscribe to exact type
  const typeSubs = sessionState.subscriptions.get(definition.type) ?? [];
  for (const sub of typeSubs) {
    try {
      pending.push(sub(payload));
    } catch (error) {
      console.error("[Bus] Subscriber error:", error);
    }
  }

  // Subscribe to wildcard
  const wildcardSubs = sessionState.subscriptions.get("*") ?? [];
  for (const sub of wildcardSubs) {
    try {
      pending.push(sub(payload));
    } catch (error) {
      console.error("[Bus] Wildcard subscriber error:", error);
    }
  }

  // Broadcast to GlobalBus for cross-instance and SSE
  publishGlobal(
    sessionId,
    definition.type,
    properties as unknown
  );

  // Wait for all subscribers to complete
  await Promise.all(pending);
}

/**
 * Subscribe to a specific event type
 * 
 * @param definition - Event definition
 * @param callback - Event handler
 * @param sessionId - Optional session ID for scoping
 * @returns Unsubscribe function
 * 
 * @example
 * ```typescript
 * const unsubscribe = Bus.subscribe(StreamTextEvent, (event) => {
 *   console.log(event.properties.content);
 * });
 * 
 * // Later...
 * unsubscribe();
 * ```
 */
export function subscribe<Def extends EventDefinition>(
  definition: Def,
  callback: (event: EventPayload<Def>) => void | Promise<void>,
  sessionId?: string
): () => void {
  return raw(definition.type, callback, sessionId);
}

/**
 * Subscribe to all events (wildcard)
 * 
 * @param callback - Event handler
 * @param sessionId - Optional session ID for scoping
 * @returns Unsubscribe function
 */
export function subscribeAll(
  callback: (event: { type: string; properties: unknown }) => void | Promise<void>,
  sessionId?: string
): () => void {
  return raw("*", callback, sessionId);
}

/**
 * Subscribe to events for a specific session only
 * 
 * @param sessionId - Session ID to filter
 * @param callback - Event handler
 * @returns Unsubscribe function
 */
export function subscribeToSession(
  sessionId: string,
  callback: (event: { type: string; properties: unknown }) => void | Promise<void>
): () => void {
  return subscribeGlobal((data) => {
    if (data.sessionId === sessionId || data.sessionId === undefined) {
      callback(data.payload);
    }
  });
}

/**
 * Subscribe once to an event
 * 
 * @param definition - Event definition
 * @param callback - Event handler (return "done" to unsubscribe)
 * @param sessionId - Optional session ID for scoping
 */
export function once<Def extends EventDefinition>(
  definition: Def,
  callback: (event: EventPayload<Def>) => "done" | void | Promise<"done" | void>,
  sessionId?: string
): void {
  const unsubscribe = subscribe(definition, async (event) => {
    const result = await callback(event);
    if (result === "done") {
      unsubscribe();
    }
  }, sessionId);
}

/**
 * Internal subscription function
 */
function raw(
  type: string,
  callback: Subscription,
  sessionId?: string
): () => void {
  console.log("[Bus] Subscribing:", { type, sessionId });
  
  const sessionState = getSessionState(sessionId);
  const subscriptions = sessionState.subscriptions;
  
  let subs = subscriptions.get(type);
  if (!subs) {
    subs = [];
    subscriptions.set(type, subs);
  }
  subs.push(callback);

  // Return unsubscribe function
  return () => {
    console.log("[Bus] Unsubscribing:", { type, sessionId });
    const match = subscriptions.get(type);
    if (!match) return;
    
    const index = match.indexOf(callback);
    if (index === -1) return;
    
    match.splice(index, 1);
    
    // Clean up empty subscription lists
    if (match.length === 0) {
      subscriptions.delete(type);
    }
  };
}

/**
 * Clear all subscriptions for a session
 * 
 * @param sessionId - Session ID to clear
 */
export function clearSession(sessionId: string): void {
  console.log("[Bus] Clearing session:", sessionId);
  state.delete(sessionId);
}

/**
 * Get statistics for debugging
 */
export function getStats(): {
  sessions: number;
  subscriptions: number;
} {
  let totalSubs = 0;
  for (const sessionState of state.values()) {
    for (const subs of sessionState.subscriptions.values()) {
      totalSubs += subs.length;
    }
  }
  
  return {
    sessions: state.size,
    subscriptions: totalSubs,
  };
}
