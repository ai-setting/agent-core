/**
 * @fileoverview EventBus type definitions
 */

import type { ZodType } from "zod";

/**
 * Event definition type
 */
export interface EventDefinition<Type extends string = string, Properties extends ZodType = ZodType> {
  type: Type;
  properties: Properties;
}

/**
 * Event payload type
 */
export interface EventPayload<Def extends EventDefinition> {
  type: Def["type"];
  properties: Def["properties"] extends ZodType<infer T> ? T : never;
}

/**
 * Event handler function type
 */
export type EventHandler<Payload = any> = (event: Payload) => void | Promise<void>;

/**
 * Unsubscribe function type
 */
export type Unsubscribe = () => void;

/**
 * Session context for event routing
 */
export interface EventContext {
  sessionId?: string;
  messageId?: string;
  timestamp: number;
}

/**
 * Stream event types
 */
export type StreamEventType = 
  | "stream.start"
  | "stream.text"
  | "stream.reasoning"
  | "stream.tool.call"
  | "stream.tool.result"
  | "stream.completed"
  | "stream.error";
