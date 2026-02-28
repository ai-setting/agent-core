/**
 * @fileoverview Event Processor - Utility for processing events in session context
 * 
 * This module provides a generic function to process events by:
 * 1. Getting the session from trigger_session_id
 * 2. Inserting 3 messages into session history (user, assistant with tool call, tool result)
 * 3. Continuing execution by calling handle_query with the updated history
 */

import type { EnvEvent } from "./types/event.js";
import type { ModelMessage } from "ai";

interface HistoryMessageWithTool {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Record<string, unknown> | Array<Record<string, unknown>>;
  name?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
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
  addAssistantMessageWithTool(toolCallId: string, toolName: string, toolArgs: Record<string, unknown>): void;
  addToolMessage(toolName: string, callID: string, output: string, input: Record<string, unknown>): void;
  addMessageFromModelMessage(message: ModelMessage): string;
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
  getActiveSessionManager?: () => {
    getActiveSession: (clientId: string) => string | undefined;
  };
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

  let sessionId = event.metadata.trigger_session_id;
  
  // Fallback: 如果没有 trigger_session_id，尝试从 ActiveSessionManager 获取
  if (!sessionId) {
    const clientId = event.metadata.clientId as string | undefined;
    if (clientId && env.getActiveSessionManager) {
      const activeSessionManager = env.getActiveSessionManager();
      sessionId = activeSessionManager.getActiveSession(clientId);
      if (sessionId) {
        console.log(`[EventProcessor] Using active session from clientId ${clientId}: ${sessionId}`);
      }
    }
  }
  
  if (!sessionId) {
    console.warn("[EventProcessor] No trigger_session_id in event metadata and no active session available");
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
      if (msg.toolCallId && msg.toolName) {
        session.addAssistantMessageWithTool(
          msg.toolCallId,
          msg.toolName,
          msg.toolArgs || {}
        );
      } else {
        session.addAssistantMessage(msg.content as string);
      }
    } else if (msg.role === "tool") {
      const toolContent = msg.content as Array<any>;
      if (toolContent && Array.isArray(toolContent) && toolContent[0]) {
        const toolResult = toolContent[0];
        const toolCallId = toolResult.toolCallId || msg.toolCallId;
        const toolName = toolResult.toolName || msg.toolName;
        const output = typeof toolResult.output === "string" 
          ? toolResult.output 
          : JSON.stringify(toolResult.output);
        session.addToolMessage(toolName, toolCallId, output, toolResult.input || {});
      } else {
        const toolCallId = msg.toolCallId || "";
        const toolName = msg.toolName || "";
        const output = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        session.addToolMessage(toolName, toolCallId, output, {});
      }
    }
  });

  const history = session.toHistory();
  const query = prompt || `Process event: ${event.type}`;
  
  await env.handle_query(
    query,
    { 
      session_id: sessionId,
      onMessageAdded: (message: ModelMessage) => {
        session.addMessageFromModelMessage(message);
      }
    },
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

  const userTextParts = [
    `Observed event: ${event.type}`,
    `Event ID: ${event.id}`,
    `Time: ${new Date(event.timestamp).toISOString()}`,
  ];

  if (event.metadata?.agent_guide) {
    userTextParts.push(`\nAgent处理指南: ${event.metadata.agent_guide}`);
  }

  const userText = userTextParts.join("\n");

  const userMessage: HistoryMessageWithTool = {
    role: "user",
    content: userText,
  };

  if (!includeToolCall) {
    return [userMessage];
  }

  const toolResult = JSON.stringify({
    event_id: event.id,
    event_type: event.type,
    timestamp: event.timestamp,
    metadata: event.metadata,
    payload: event.payload,
  });

  const toolCallId = `call_${event.id}`;

  return [
    userMessage,
    {
      role: "assistant",
      content: "",
      toolCallId,
      toolName,
      toolArgs: { event_ids: [event.id] },
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: toolCallId,
          toolName: toolName,
          output: { type: "text", value: toolResult },
        },
      ],
      toolCallId: toolCallId,
    },
  ];
}
