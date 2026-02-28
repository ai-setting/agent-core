/**
 * @fileoverview EventHandlerAgent - Stateless agent for handling environment events
 * 
 * This agent is created fresh for each event to process it.
 * It constructs 3 fake messages and triggers handle_query to process the event.
 */

import type { EnvEvent } from "../types/event.js";
import type { ModelMessage } from "ai";
import { createLogger } from "../../utils/logger.js";

const eventHandlerLogger = createLogger("event:handler", "server.log");

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
    eventHandlerLogger.debug(`[EventHandler] Handling event: type=${event.type}, id=${event.id}, trigger_session_id=${event.metadata.trigger_session_id}`);
    
    let sessionId = event.metadata.trigger_session_id;
    
    // Fallback: 如果没有 trigger_session_id，尝试从 ActiveSessionManager 获取
    if (!sessionId) {
      const clientId = event.metadata.clientId;
      if (clientId && this.env.getActiveSessionManager) {
        sessionId = this.env.getActiveSessionManager().getActiveSession(clientId);
        if (sessionId) {
          eventHandlerLogger.debug(`Using active session from clientId ${clientId}: ${sessionId}`);
        }
      }
    }
    
    if (!sessionId) {
      eventHandlerLogger.warn("No trigger_session_id in event metadata and no active session available");
      return;
    }

    eventHandlerLogger.debug(`[EventHandler] Using session: ${sessionId}`);
    
    const session = await this.env.getSession?.(sessionId);
    if (!session) {
      eventHandlerLogger.warn(`Session not found: ${sessionId}`);
      return;
    }

    eventHandlerLogger.debug(`[EventHandler] Session found, constructing messages for event ${event.type}`);
    const messages = this.constructMessages(event);
    eventHandlerLogger.debug(`[EventHandler] Constructed ${messages.length} messages for event ${event.id}`);

    for (const msg of messages) {
      const msgStr = JSON.stringify(msg).substring(0, 200);
      eventHandlerLogger.debug(`[EventHandler] Adding message to session: role=${(msg as any).role}, contentType=${typeof (msg as any).content}, isArray=${Array.isArray((msg as any).content)}`);
      if ((msg as any).role === "assistant" && Array.isArray((msg as any).content)) {
        const toolCalls = (msg as any).content.filter((p: any) => p.type === "tool-call");
        eventHandlerLogger.debug(`[EventHandler]   assistant message has ${toolCalls.length} tool-calls: ${JSON.stringify(toolCalls.map((t: any) => t.toolCallId))}`);
      }
      if ((msg as any).role === "tool" && Array.isArray((msg as any).content)) {
        const toolResults = (msg as any).content.filter((p: any) => p.type === "tool-result");
        eventHandlerLogger.debug(`[EventHandler]   tool message has ${toolResults.length} tool-results`);
      }
      
      const modelMessage: ModelMessage = msg as any;
      session.addMessageFromModelMessage(modelMessage);
    }

    const history = session.toHistory();
    eventHandlerLogger.debug(`[EventHandler] toHistory returned ${history.length} messages`);
    eventHandlerLogger.debug(`[EventHandler] Now calling handle_query for session ${sessionId}`);
    
    await this.env.handle_query(
      `Process event: ${event.type}`,
      {
        session_id: sessionId,
        onMessageAdded: (message: ModelMessage) => {
          eventHandlerLogger.info(`onMessageAdded: role=${message.role}`);
          session.addMessageFromModelMessage(message);
        },
      },
      history
    );
  }

  private constructMessages<T>(event: EnvEvent<T>): HistoryMessageWithTool[] {
    const userTextParts = [
      `Observed event: ${event.type}`,
      `Event ID: ${event.id}`,
      `Time: ${new Date(event.timestamp).toISOString()}`,
    ];

    if (event.metadata?.agent_guide) {
      userTextParts.push(`\nAgent处理指南: ${event.metadata.agent_guide}`);
    }

    const userText = userTextParts.join("\n");

    const toolResult = JSON.stringify({
      event_id: event.id,
      event_type: event.type,
      timestamp: event.timestamp,
      metadata: event.metadata,
      payload: event.payload,
    }, null, 2);

    const toolCallId = `call_${event.id}`;

    const messages: HistoryMessageWithTool[] = [
      {
        role: "user",
        content: userText,
      },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: toolCallId,
            toolName: "get_event_info",
            input: { event_ids: [event.id] },
          },
        ],
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
      },
    ];

    eventHandlerLogger.info(`constructMessages returning ${messages.length} messages`);
    messages.forEach((msg: HistoryMessageWithTool, i: number) => {
      eventHandlerLogger.info(`  [${i}] role=${msg.role}`);
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        const toolCalls = (msg.content as any[]).filter((p) => p.type === "tool-call");
        eventHandlerLogger.info(`    tool-calls: ${JSON.stringify(toolCalls.map((t) => t.toolCallId))}`);
      }
      if (msg.role === "tool" && Array.isArray(msg.content)) {
        const toolResults = (msg.content as any[]).filter((p) => p.type === "tool-result");
        eventHandlerLogger.info(`    tool-results: ${JSON.stringify(toolResults.map((t) => t.toolCallId))}`);
      }
    });

    return messages;
  }
}
