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
        session.addAssistantMessage(msg.content as string);
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
    const userContent: TextContent = {
      type: "text",
      text: [
        `Observed event: ${event.type}`,
        `Event ID: ${event.id}`,
        `Time: ${new Date(event.timestamp).toISOString()}`,
      ].join("\n"),
    };

    return [
      {
        role: "user",
        content: userContent.text,
      },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: `call_${event.id}`,
            type: "function",
            function: {
              name: "get_event_info",
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
}
