/**
 * @fileoverview Event Processor - Utility for processing events in session context
 * 
 * This module provides a generic function to process events by:
 * 1. Getting the session from trigger_session_id
 * 2. Inserting 3 messages into session history (user, assistant with tool call, tool result)
 * 3. Continuing execution by calling handle_query with the updated history
 */

import type { EnvEvent } from "./types/event.js";

interface HistoryMessageWithTool {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Record<string, unknown>;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export interface SessionLike {
  addUserMessage(content: string): void;
  addAssistantMessage(content: string): void;
  toHistory(): HistoryMessageWithTool[];
}

export interface EventProcessorOptions {
  /** Custom prompt for handle_query (default: "Process event: {event.type}") */
  prompt?: string;
  /** Whether to include tool call in messages (default: true) */
  includeToolCall?: boolean;
  /** Custom tool name for the tool call (default: "get_event_info") */
  toolName?: string;
}

export interface EventProcessorEnv {
  getSession?: (id: string) => SessionLike | undefined;
  handle_query: (query: string, ctx: any, history: any[]) => Promise<string>;
}

/**
 * Process an event by inserting messages into session and continuing execution
 * 
 * @param env - Environment with getSession and handle_query methods
 * @param event - The event to process
 * @param options - Optional configuration
 */
export async function processEventInSession<T>(
  env: EventProcessorEnv,
  event: EnvEvent<T>,
  options: EventProcessorOptions = {}
): Promise<void> {
  const {
    prompt,
    includeToolCall = true,
    toolName = "get_event_info"
  } = options;

  const sessionId = event.metadata.trigger_session_id;
  if (!sessionId) {
    console.warn("[EventProcessor] No trigger_session_id in event metadata");
    return;
  }

  const session = await env.getSession?.(sessionId);
  if (!session) {
    console.warn(`[EventProcessor] Session not found: ${sessionId}`);
    return;
  }

  const messages = constructEventMessages(event, { includeToolCall, toolName });

  messages.forEach((msg) => {
    if (msg.role === "user") {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      session.addUserMessage(content);
    } else if (msg.role === "assistant") {
      session.addAssistantMessage(msg.content as string);
    }
  });

  const history = session.toHistory();
  const query = prompt || `Process event: ${event.type}`;
  
  await env.handle_query(
    query,
    { session_id: sessionId },
    history
  );
}

/**
 * Construct the 3 messages for event processing
 */
function constructEventMessages<T>(
  event: EnvEvent<T>,
  options: { includeToolCall: boolean; toolName: string }
): HistoryMessageWithTool[] {
  const { includeToolCall, toolName } = options;

  const userMessage: HistoryMessageWithTool = {
    role: "user",
    content: [
      `Observed event: ${event.type}`,
      `Event ID: ${event.id}`,
      `Time: ${new Date(event.timestamp).toISOString()}`,
    ].join("\n"),
  };

  if (!includeToolCall) {
    return [userMessage];
  }

  return [
    userMessage,
    {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: `call_${event.id}`,
          type: "function",
          function: {
            name: toolName,
            arguments: JSON.stringify({ event_ids: [event.id] }),
          },
        },
      ],
    },
    {
      role: "tool",
      tool_call_id: `call_${event.id}`,
      content: JSON.stringify({
        event_id: event.id,
        event_type: event.type,
        timestamp: event.timestamp,
        metadata: event.metadata,
        payload: event.payload,
      }),
    },
  ];
}
