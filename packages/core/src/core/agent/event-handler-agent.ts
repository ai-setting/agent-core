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
    eventHandlerLogger.info(`Handling event: type=${event.type}, id=${event.id}, trigger_session_id=${event.metadata.trigger_session_id}`);
    
    let sessionId = event.metadata.trigger_session_id;
    
    // Fallback 1: 如果没有 trigger_session_id，尝试从 ActiveSessionManager 获取
    if (!sessionId) {
      const clientId = event.metadata.clientId;
      if (clientId && this.env.getActiveSessionManager) {
        sessionId = this.env.getActiveSessionManager().getActiveSession(clientId);
        if (sessionId) {
          eventHandlerLogger.info(`Using active session from clientId ${clientId}: ${sessionId}`);
        }
      }
    }
    
    // Fallback 2: 如果还是没有 sessionId，创建新 session
    let session;
    if (sessionId) {
      session = await this.env.getSession?.(sessionId);
      if (!session) {
        eventHandlerLogger.warn(`Session not found: ${sessionId}, creating new session`);
        session = await this.createFallbackSession(event);
      }
    } else {
      eventHandlerLogger.info("No trigger_session_id and no active session, creating new session");
      session = await this.createFallbackSession(event);
    }

    await this.processEventWithSession(session, event);
  }

  private async createFallbackSession<T>(event: EnvEvent<T>): Promise<any> {
    const fallbackTitle = `[Event] ${event.type} - ${new Date(event.timestamp).toISOString()}`;
    const newSession = await this.env.createSession?.({ title: fallbackTitle });
    if (!newSession) {
      eventHandlerLogger.error("Failed to create fallback session");
      throw new Error("No session available and failed to create fallback session");
    }
    eventHandlerLogger.info(`Created fallback session: ${newSession.id}`);
    return newSession;
  }

  private async processEventWithSession<T>(session: any, event: EnvEvent<T>): Promise<void> {
    const sessionId = session.id;
    const messages = this.constructMessages(event);
    eventHandlerLogger.info(`Constructed ${messages.length} messages for event ${event.id}`);

    for (const msg of messages) {
      const msgStr = JSON.stringify(msg).substring(0, 200);
      eventHandlerLogger.debug(`Adding message: role=${(msg as any).role}`);
      
      const modelMessage: ModelMessage = msg as any;
      session.addMessageFromModelMessage(modelMessage);
    }

    const history = session.toHistory();
    eventHandlerLogger.debug(`toHistory returned ${history.length} messages`);
    
    const query = `Process event: ${event.type}`;
    
    try {
      await this.env.handle_query(
        query,
        {
          session_id: sessionId,
          onMessageAdded: (message: ModelMessage) => {
            eventHandlerLogger.debug(`onMessageAdded: role=${message.role}`);
            session.addMessageFromModelMessage(message);
          },
        },
        history
      );
    } catch (error) {
      eventHandlerLogger.error(`handle_query failed: ${error instanceof Error ? error.message : String(error)}`);
      await this.retryWithNewSession(sessionId, query, error);
    }
  }

  private async retryWithNewSession(originalSessionId: string, query: string, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const maxRetries = 3;
    
    for (let retry = 1; retry <= maxRetries; retry++) {
      eventHandlerLogger.info(`Retry attempt ${retry}/${maxRetries} with new session`);
      
      const fallbackTitle = `[Event Retry ${retry}] ${new Date().toISOString()}`;
      const newSession = await this.env.createSession?.({ title: fallbackTitle });
      
      if (!newSession) {
        eventHandlerLogger.error("Failed to create retry session");
        return;
      }

      const errorMsg = `[System] An error occurred while processing your previous request.
Error: ${errorMessage}

Your original request: ${query}

A new session has been started. Please continue from here.`;

      newSession.addUserMessage(errorMsg);
      
      const history = newSession.toHistory();
      
      try {
        await this.env.handle_query(
          `Continue from error recovery`,
          {
            session_id: newSession.id,
            onMessageAdded: (message: ModelMessage) => {
              eventHandlerLogger.debug(`Retry onMessageAdded: role=${message.role}`);
              newSession.addMessageFromModelMessage(message);
            },
          },
          history
        );
        eventHandlerLogger.info(`Retry succeeded with session ${newSession.id}`);
        return;
      } catch (retryError) {
        const retryErrorMsg = retryError instanceof Error ? retryError.message : String(retryError);
        eventHandlerLogger.warn(`Retry attempt ${retry} failed: ${retryErrorMsg}`);
        
        if (retry === maxRetries) {
          eventHandlerLogger.error(`All ${maxRetries} retry attempts failed`);
        }
      }
    }
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
