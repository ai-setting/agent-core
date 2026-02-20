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
import type { EnvEvent } from "../../core/types/event.js";
import { busLogger } from "../logger.js";

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
    // Only match events with exact sessionId (not undefined)
    if (data.sessionId === sessionId) {
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

/**
 * Event handler for function-based processing
 */
export interface EnvEventHandler {
  type: "function";
  fn: (event: EnvEvent) => Promise<void>;
}

/**
 * Agent handler for AI-based processing
 */
export interface EnvAgentHandler {
  type: "agent";
  prompt: string;
  systemPrompt?: string;
}

/**
 * Event rule for routing events to handlers
 */
export interface EnvEventRule {
  eventType: string | string[];
  handler: EnvEventHandler | EnvAgentHandler;
  options?: {
    enabled?: boolean;
    priority?: number;
  };
}

/**
 * EnvEventBus - Event processing bus with rule-based routing
 * 
 * Provides unified event processing with:
 * - Rule-based event routing
 * - Queue mechanism for handling rapid events
 * - Idempotency check
 * - Function and Agent handler support
 */
export class EnvEventBus {
  private rules: EnvEventRule[] = [];
  private queue: EnvEvent[] = [];
  private processing: boolean = false;
  private seen: Set<string> = new Set();
  private env: any;

  constructor(env?: any) {
    this.env = env;
  }

  /**
   * Set environment reference for agent handlers
   */
  setEnv(env: any): void {
    this.env = env;
  }

  /**
   * Publish an event to the bus
   * Handles idempotency, queueing, and processing
   */
  async publish<T>(event: EnvEvent<T>): Promise<void> {
    busLogger.debug(`[EnvEventBus] Publishing event: ${event.type}`, { id: event.id });
    if (this.seen.has(event.id)) {
      busLogger.warn(`[EnvEventBus] Duplicate event ignored: ${event.id}`);
      return;
    }

    this.seen.add(event.id);
    this.queue.push(event as EnvEvent);
    await this.processQueue();
  }

  /**
   * Process events in the queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      await this.handleEvent(event);
    }

    this.processing = false;
  }

  /**
   * Handle a single event - match rule and execute handler
   */
  private async handleEvent<T>(event: EnvEvent<T>): Promise<void> {
    busLogger.debug(`[EnvEventBus] Handling event: ${event.type}`);
    const matchedRule = this.findMatchedRule(event.type);

    if (!matchedRule) {
      busLogger.warn(`[EnvEventBus] No rule matched for event: ${event.type}`);
      return;
    }

    busLogger.debug(`[EnvEventBus] Found rule for event: ${event.type}, handler type: ${matchedRule.handler.type}`);
    if (matchedRule.options?.enabled !== false) {
      if (matchedRule.handler.type === "function") {
        busLogger.debug(`[EnvEventBus] Calling function handler for: ${event.type}`);
        await matchedRule.handler.fn(event);
      } else if (matchedRule.handler.type === "agent") {
        await this.handleWithAgent(event, matchedRule.handler);
      }
    }
  }

  /**
   * Handle event with agent
   */
  private async handleWithAgent<T>(event: EnvEvent<T>, handler: EnvAgentHandler): Promise<void> {
    if (!this.env) {
      console.error("[EnvEventBus] No env configured for agent handler");
      return;
    }

    const { EventHandlerAgent } = await import("../../core/agent/event-handler-agent.js");
    const agent = new EventHandlerAgent(this.env, handler.prompt, handler.systemPrompt);
    await agent.handle(event);
  }

  /**
   * Find matching rule for event type
   */
  private findMatchedRule(eventType: string): EnvEventRule | undefined {
    for (const rule of this.rules) {
      const types = Array.isArray(rule.eventType) ? rule.eventType : [rule.eventType];

      for (const type of types) {
        if (type === "*") {
          return rule;
        }
        if (type === eventType) {
          return rule;
        }
        if (type.endsWith(".*")) {
          const prefix = type.slice(0, -1);
          if (eventType.startsWith(prefix)) {
            return rule;
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Register a new event rule
   */
  registerRule(rule: EnvEventRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => (b.options?.priority ?? 0) - (a.options?.priority ?? 0));
  }

  /**
   * Get all registered rules
   */
  getRules(): EnvEventRule[] {
    return [...this.rules];
  }

  /**
   * Get queue status
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Clear seen set (for testing)
   */
  clearSeen(): void {
    this.seen.clear();
  }
}
