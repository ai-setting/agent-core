/**
 * @fileoverview EventHandlerAgent - Stateless agent for handling environment events
 * 
 * This agent is created fresh for each event to process it.
 * It constructs 3 fake messages and triggers handle_query to process the event.
 */

import type { EnvEvent } from "../types/event.js";
import type { TextContent } from "../environment/index.js";

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

export class EventHandlerAgent {
  constructor(
    private env: any,
    private prompt: string,
    private systemPrompt?: string
  ) {}

  async handle<T>(event: EnvEvent<T>): Promise<void> {
    let sessionId = event.metadata.trigger_session_id;
    
    // Fallback: 如果没有 trigger_session_id，尝试从 ActiveSessionManager 获取
    if (!sessionId) {
      const clientId = event.metadata.clientId;
      if (clientId && this.env.getActiveSessionManager) {
        sessionId = this.env.getActiveSessionManager().getActiveSession(clientId);
        if (sessionId) {
          console.log(`[EventHandlerAgent] Using active session from clientId ${clientId}: ${sessionId}`);
        }
      }
    }
    
    if (!sessionId) {
      console.warn("[EventHandlerAgent] No trigger_session_id in event metadata and no active session available");
      return;
    }

    const session = await this.env.getSession?.(sessionId);
    if (!session) {
      console.warn(`[EventHandlerAgent] Session not found: ${sessionId}`);
      return;
    }

    const messages = this.constructMessages(event);

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
        const toolContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
        const toolName = msg.toolName || "get_event_info";
        const toolCallId = msg.tool_call_id || `call_${event.id}`;
        session.addToolMessage(toolName, toolCallId, toolContent);
      }
    });

    const history = session.toHistory();
    await this.env.handle_query(
      `Process event: ${event.type}`,
      { session_id: sessionId },
      history
    );
  }

  private constructMessages<T>(event: EnvEvent<T>): HistoryMessageWithTool[] {
    const userText = [
      `Observed event: ${event.type}`,
      `Event ID: ${event.id}`,
      `Time: ${new Date(event.timestamp).toISOString()}`,
    ].join("\n");

    const toolResult = JSON.stringify({
      event_id: event.id,
      event_type: event.type,
      timestamp: event.timestamp,
      metadata: event.metadata,
      payload: event.payload,
    });

    const toolCallId = `call_${event.id}`;

    return [
      {
        role: "user",
        content: userText,
      },
      {
        role: "assistant",
        content: "",
        toolCallId,
        toolName: "get_event_info",
        toolArgs: { event_ids: [event.id] },
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: toolCallId,
            toolName: "get_event_info",
            output: { type: "text", value: toolResult },
          },
        ],
        toolCallId: toolCallId,
      },
    ];
  }
}
