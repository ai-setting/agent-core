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
    eventHandlerLogger.info(`Handling event: type=${event.type}, id=${event.id}`);
    
    // 通过 chat_id 查找已存在的 session
    // chat_id 可能位于多个位置，尝试从不同路径提取
    const chatId = this.extractChatId(event);
    let sessionId: string | undefined;
    
    if (chatId && this.env.findSessionsByMetadata) {
      const relatedSessionIds = await this.env.findSessionsByMetadata({ chat_id: chatId });
      eventHandlerLogger.info(`findSessionsByMetadata for chat_id ${chatId}: ${JSON.stringify(relatedSessionIds)}`);
      if (relatedSessionIds.length > 0) {
        sessionId = relatedSessionIds[0];
        eventHandlerLogger.info(`Found existing session by chat_id ${chatId}: ${sessionId}`);
      }
    }

    // 获取或创建 session
    let session;
    if (sessionId) {
      session = await this.env.getSession?.(sessionId);
      if (!session) {
        eventHandlerLogger.warn(`Session not found: ${sessionId}, creating new session`);
        session = await this.createFallbackSession(event);
      }
    } else {
      eventHandlerLogger.info("No existing session found by chat_id, creating new session");
      session = await this.createFallbackSession(event);
    }

    await this.processEventWithSession(session, event, chatId);
  }

  private async processEventWithSession<T>(session: any, event: EnvEvent<T>, chatId?: string): Promise<void> {
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
      await this.retryWithNewSession(sessionId, query, error, chatId);
    }
  }

  private async createFallbackSession<T>(event: EnvEvent<T>): Promise<any> {
    const fallbackTitle = `[Event] ${event.type} - ${new Date(event.timestamp).toISOString()}`;
    const metadata: Record<string, unknown> = {
      trigger_type: "event",
      created_at: Date.now(),
      event_type: event.type,
      event_id: event.id,
      ...event.metadata,
    };
    const newSession = await this.env.createSession?.({ 
      title: fallbackTitle,
      metadata,
    });
    eventHandlerLogger.info(`Creating session with metadata: ${JSON.stringify(metadata)}`);
    if (!newSession) {
      eventHandlerLogger.error("Failed to create fallback session");
      throw new Error("No session available and failed to create fallback session");
    }
    eventHandlerLogger.info(`Created fallback session: ${newSession.id}`);
    
    return newSession;
  }

  private async loadRelatedSessionHistory(session: any, sourceSessionId: string): Promise<void> {
    eventHandlerLogger.info(`loadRelatedSessionHistory: loading from session ${sourceSessionId} to ${session.id}`);

    try {
      // 获取源 session 的历史消息
      const messagesResult = await this.env.getSessionMessages?.(sourceSessionId, {
        offset: 0,
        limit: 50,
      });

      if (messagesResult && messagesResult.messages.length > 0) {
        // 找到第一个 role 为 user 的消息作为起始点，确保消息链完整
        const startIndex = messagesResult.messages.findIndex((m: { role: string }) => m.role === "user");
        const validMessages = startIndex >= 0 ? messagesResult.messages.slice(startIndex) : messagesResult.messages;
        
        // 整合成一条 user message 作为背景
        const historyContent = validMessages
          .map((msg: { role: string; content: string }) => `[${msg.role}]: ${msg.content}`)
          .join("\n\n");
        
        const backgroundMsg = `[Background History from previous session ${sourceSessionId}:\n${historyContent}]`;
        session.addUserMessage?.(backgroundMsg);
        eventHandlerLogger.info(`Loaded ${validMessages.length} related messages as single background message`);
      }
    } catch (error) {
      eventHandlerLogger.warn(`Failed to load related session history: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async retryWithNewSession(originalSessionId: string, query: string, error: unknown, chatId?: string): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const maxRetries = 3;
    
    for (let retry = 1; retry <= maxRetries; retry++) {
      eventHandlerLogger.info(`Retry attempt ${retry}/${maxRetries} with new session`);
      
      const fallbackTitle = `[Event Retry ${retry}] ${new Date().toISOString()}`;
      const metadata: Record<string, unknown> = chatId ? { chat_id: chatId, trigger_type: "event_retry" } : { trigger_type: "event_retry" };
      const newSession = await this.env.createSession?.({ title: fallbackTitle, metadata });
      
      if (!newSession) {
        eventHandlerLogger.error("Failed to create retry session");
        return;
      }

      // 加载原 session 的历史消息作为背景
      if (originalSessionId) {
        await this.loadRelatedSessionHistory(newSession, originalSessionId);
      }

      const errorMsg = `[System] An error occurred while processing your previous request.
Error: ${errorMessage}

Your original request: ${query}

A new session has been started. Please continue from here.

After handling this error, please reply to the user who triggered this event (e.g., use feishu_reply tool if from Feishu).`;

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

  private extractChatId<T>(event: EnvEvent<T>): string | undefined {
    // 尝试从多个可能的位置提取 chat_id
    // 1. event.metadata.chat_id (通用位置)
    if (event.metadata?.chat_id && typeof event.metadata.chat_id === "string") {
      return event.metadata.chat_id;
    }
    
    // 2. event.payload.message.chat_id (如飞书 IM 事件)
    const payload = event.payload as Record<string, unknown> | undefined;
    if (payload?.message && typeof payload.message === "object") {
      const message = payload.message as Record<string, unknown>;
      if (message.chat_id && typeof message.chat_id === "string") {
        return message.chat_id;
      }
    }
    
    // 3. event.payload.chat_id (部分事件的直接位置)
    if (payload?.chat_id && typeof payload.chat_id === "string") {
      return payload.chat_id;
    }
    
    return undefined;
  }
}
