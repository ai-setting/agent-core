/**
 * @fileoverview Stream events for LLM streaming responses
 */

import { z } from "zod";
import { define } from "../bus-event.js";

/**
 * Stream started event
 */
export const StreamStartEvent = define(
  "stream.start",
  z.object({
    sessionId: z.string(),
    messageId: z.string(),
    model: z.string(),
  })
);

/**
 * Text chunk event (streamed content)
 */
export const StreamTextEvent = define(
  "stream.text",
  z.object({
    sessionId: z.string(),
    messageId: z.string(),
    content: z.string(),  // Accumulated content
    delta: z.string(),    // New chunk
  })
);

/**
 * Reasoning event (for models that support reasoning)
 */
export const StreamReasoningEvent = define(
  "stream.reasoning",
  z.object({
    sessionId: z.string(),
    messageId: z.string(),
    content: z.string(),
  })
);

/**
 * Tool call event
 */
export const StreamToolCallEvent = define(
  "stream.tool.call",
  z.object({
    sessionId: z.string(),
    messageId: z.string(),
    toolName: z.string(),
    toolArgs: z.record(z.unknown()),
    toolCallId: z.string(),
  })
);

/**
 * Tool result event
 */
export const StreamToolResultEvent = define(
  "stream.tool.result",
  z.object({
    sessionId: z.string(),
    messageId: z.string(),
    toolName: z.string(),
    toolCallId: z.string(),
    result: z.unknown(),
    success: z.boolean(),
  })
);

/**
 * Stream completed event
 */
export const StreamCompletedEvent = define(
  "stream.completed",
  z.object({
    sessionId: z.string(),
    messageId: z.string(),
    usage: z.object({
      promptTokens: z.number(),
      completionTokens: z.number(),
      totalTokens: z.number(),
    }).optional(),
  })
);

/**
 * Stream error event
 */
export const StreamErrorEvent = define(
  "stream.error",
  z.object({
    sessionId: z.string(),
    messageId: z.string().optional(),
    error: z.string(),
    code: z.string().optional(),
  })
);
