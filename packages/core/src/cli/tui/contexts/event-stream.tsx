/**
 * @fileoverview EventStream Context - 事件流管理
 * 
 * 管理与服务器的 SSE 连接和事件处理
 * 参考 OpenCode 的批处理机制
 */

import { createContext, useContext, createSignal, onCleanup, batch } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import { useStore, type Message, type MessagePart } from "./store.js";
import { eventLogger } from "../logger.js";

// ============================================================================
// 类型定义
// ============================================================================

export interface StreamEvent {
  type: string;
  sessionId?: string;
  messageId?: string;
  content?: string;
  delta?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
  result?: unknown;
  success?: boolean;
  error?: string;
  code?: string;
  model?: string;
}

export interface EventStreamContextValue {
  url: Accessor<string>;
  setUrl: Setter<string>;
  isConnected: Accessor<boolean>;
  error: Accessor<string | null>;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendPrompt: (content: string) => Promise<void>;
  createSession: () => Promise<string>;
  loadMessages: (sessionId: string) => Promise<void>;
}

// ============================================================================
// Context 定义
// ============================================================================

const EventStreamContext = createContext<EventStreamContextValue>();

// ============================================================================
// Provider 组件
// ============================================================================

export function EventStreamProvider(props: { 
  children: any; 
  initialUrl: string;
  password?: string;
  onExit?: () => void;
}) {
  const store = useStore();
  
  const [url, setUrl] = createSignal(props.initialUrl);
  const [isConnected, setIsConnected] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  
  let abortController: AbortController | null = null;
  let eventQueue: StreamEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFlush = 0;
  let streamStartTime = 0;
  let currentReasoningMessageId: string | null = null; // Current reasoning phase (reset after tool)
  let currentTextMessageId: string | null = null; // Final text message (only one)

  // 批处理机制 - 16ms 窗口期
  const flushEvents = () => {
    if (eventQueue.length === 0) return;
    
    const events = [...eventQueue];
    eventQueue = [];
    flushTimer = null;
    lastFlush = Date.now();
    
    // Batch all store updates so all result in a single render
    try {
      batch(() => {
        for (const event of events) {
          try {
            handleEvent(event);
          } catch (eventError) {
            eventLogger.error("Error handling event:", { 
              type: event.type, 
              messageId: event.messageId,
              error: (eventError as Error).message,
              stack: (eventError as Error).stack,
            });
            // 继续处理其他事件，不中断
          }
        }
      });
    } catch (batchError) {
      eventLogger.error("Error in batch() execution:", {
        error: (batchError as Error).message,
        stack: (batchError as Error).stack,
        eventCount: events.length,
        eventTypes: events.map(e => e.type),
      });
      // 重新抛出错误以便上层处理
      throw batchError;
    }
  };

  const queueEvent = (event: StreamEvent) => {
    eventQueue.push(event);
    const elapsed = Date.now() - lastFlush;

    if (flushTimer) return;
    
    // If we just flushed recently (within 16ms), batch this with future events
    // Otherwise, process immediately to avoid latency
    if (elapsed < 16) {
      flushTimer = setTimeout(flushEvents, 16 - elapsed);
    } else {
      flushEvents();
    }
  };

  // 处理单个事件
  const handleEvent = (event: StreamEvent) => {
    eventLogger.info("=== EVENT RECEIVED ===", { 
      type: event.type, 
      messageId: event.messageId, 
      sessionId: event.sessionId,
      content: event.content?.substring(0, 100),
      delta: event.delta?.substring(0, 100),
      toolName: event.toolName,
      toolArgs: event.toolArgs ? JSON.stringify(event.toolArgs).substring(0, 100) : undefined,
    });
    
    switch (event.type) {
      case "stream.start": {
        const streamEvent = event as StreamEvent & { model?: string };
        eventLogger.info("=== STREAM START ===", { messageId: event.messageId, model: streamEvent.model });
        streamStartTime = Date.now();
        if (streamEvent.model) store.setLastModelName(streamEvent.model);
        store.setIsStreaming(true);
        store.setStatus("Generating...");
        // Don't create message here - create when we receive specific content
        break;
      }
       
      case "stream.text": {
        // Create/update text message for each response phase
        eventLogger.info("=== STREAM TEXT ===", { delta: event.delta?.substring(0, 50) });
        if (event.delta) {
          // Close current reasoning phase - next reasoning will be new message
          if (currentReasoningMessageId) {
            eventLogger.info("Closing reasoning phase due to text");
            currentReasoningMessageId = null;
          }
          
          // Append to existing text message or create new
          if (currentTextMessageId) {
            store.appendMessageContent(currentTextMessageId, event.delta);
          } else {
            const textMessage: Message = {
              id: `text-${Date.now()}`,
              role: "assistant",
              content: event.delta,
              timestamp: Date.now(),
            };
            store.addMessage(textMessage);
            currentTextMessageId = textMessage.id;
            eventLogger.info("=== TEXT MSG CREATED ===", { messageId: textMessage.id });
          }
        }
        break;
      }
       
      case "stream.reasoning": {
        // Create/update reasoning message
        eventLogger.info("=== STREAM REASONING ===", { content: event.content?.substring(0, 50) });
        if (!currentReasoningMessageId) {
          // Create new reasoning message
          const reasoningMessage: Message = {
            id: `reasoning-${Date.now()}`,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
          };
          store.addMessage(reasoningMessage);
          currentReasoningMessageId = reasoningMessage.id;
          eventLogger.info("=== REASONING MSG CREATED ===", { messageId: reasoningMessage.id });
        }
        // Update reasoning content
        if (currentReasoningMessageId) {
          const parts = store.parts()[currentReasoningMessageId] || [];
          const reasoningPart = parts.find(p => p.type === "reasoning");
          if (reasoningPart) {
            store.updatePart(currentReasoningMessageId, reasoningPart.id, { 
              content: event.content || "" 
            });
          } else {
            store.addPart(currentReasoningMessageId, {
              id: `reasoning-part-${Date.now()}`,
              type: "reasoning",
              content: event.content || "",
              timestamp: Date.now(),
            });
          }
        }
        break;
      }
      
      case "stream.tool.call": {
        eventLogger.info("Tool call received", { messageId: event.messageId, toolName: event.toolName });
        // Close current reasoning phase - next reasoning will be new message
        if (currentReasoningMessageId) {
          eventLogger.info("Closing reasoning phase due to tool call");
          currentReasoningMessageId = null;
        }
        // Reset text message - next text will create new message
        currentTextMessageId = null;
        // Create separate message for tool call
        const toolMessage: Message = {
          id: `tool-${Date.now()}`,
          role: "assistant",
          content: `⚡ ${event.toolName || "unknown"}`,
          timestamp: Date.now(),
        };
        store.addMessage(toolMessage);
        // Store tool args as metadata
        if (event.toolArgs) {
          store.addPart(toolMessage.id, {
            id: `tool-args-${Date.now()}`,
            type: "tool_call",
            toolName: event.toolName || "unknown",
            toolArgs: event.toolArgs,
            timestamp: Date.now(),
          });
        }
        break;
      }
      
      case "stream.tool.result": {
        eventLogger.info("Tool result received", { messageId: event.messageId, toolName: event.toolName, success: event.success });
        // Find the last tool message with matching name
        const messages = store.messages();
        const lastToolMessage = [...messages].reverse().find(m => {
          const parts = store.parts()[m.id] || [];
          return parts.some((p: any) => p.type === "tool_call" && p.toolName === event.toolName);
        });
        
        if (lastToolMessage) {
          // Update the tool message with result
          const existingContent = lastToolMessage.content || "";
          const resultIcon = event.success ? "✓" : "✗";
          store.updateMessage(lastToolMessage.id, { 
            content: `${existingContent} ${resultIcon}` 
          });
          // Add result as part
          store.addPart(lastToolMessage.id, {
            id: `tool-result-${Date.now()}`,
            type: "tool_result",
            toolName: event.toolName || "unknown",
            result: event.result,
            success: event.success,
            timestamp: Date.now(),
          });
        }
        break;
      }
      
      case "stream.completed": {
        eventLogger.info("Stream completed", { messageId: event.messageId });
        if (streamStartTime > 0) {
          store.setLastResponseTimeMs(Date.now() - streamStartTime);
          streamStartTime = 0;
        }
        store.setIsStreaming(false);
        store.setStatus("Ready");
        // Reset for next query - only text message, reasoning continues naturally
        currentTextMessageId = null;
        break;
      }
      
      case "stream.error": {
        eventLogger.error("Stream error", { messageId: event.messageId, error: event.error });
        store.setError(event.error || "Unknown error");
        store.setIsStreaming(false);
        store.setStatus("Error");
        break;
      }
      
      case "server.connected": {
        eventLogger.info("Server connected");
        break;
      }
      
      case "server.heartbeat": {
        eventLogger.debug("Heartbeat received");
        break;
      }

      case "application.exit": {
        eventLogger.info("Exit requested from server", event);
        if (props.onExit) {
          props.onExit();
        }
        break;
      }
      
      default: {
        eventLogger.warn("Unknown event type", { type: event.type });
      }
    }
  };

  // API 调用辅助函数
  const apiCall = async (endpoint: string, options?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    if (props.password) {
      headers["Authorization"] = `Bearer ${props.password}`;
    }
    
    return fetch(`${url()}${endpoint}`, {
      ...options,
      headers: { ...headers, ...(options?.headers as Record<string, string> || {}) },
    });
  };

  // 连接到事件流
  const connect = async () => {
    const sessionId = store.sessionId();
    if (!sessionId) {
      eventLogger.error("Cannot connect: No session ID");
      setError("No session ID");
      return;
    }

    eventLogger.info("Connecting to event stream", { sessionId, url: url() });

    try {
      abortController = new AbortController();
      
      const response = await apiCall(`/events?session=${encodeURIComponent(sessionId)}`, {
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to connect: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      setIsConnected(true);
      setError(null);
      store.setIsConnected(true);
      eventLogger.info("Connected to event stream", { sessionId });

      // 读取 SSE 流
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventCount = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            eventLogger.info("Event stream closed", { sessionId, totalEvents: eventCount });
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = line.slice(6);
                if (data === "[DONE]") continue;
                
                const event = JSON.parse(data) as StreamEvent;
                eventCount++;
                queueEvent(event);
              } catch (e) {
                eventLogger.warn("Failed to parse event data", { data: line.slice(0, 100) });
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        eventLogger.error("Event stream error", { error: (err as Error).message });
        setError((err as Error).message);
        setIsConnected(false);
        store.setIsConnected(false);
      }
    }
  };

  // 断开连接
  const disconnect = () => {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    setIsConnected(false);
    store.setIsConnected(false);
    
    // Flush any pending events
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushEvents();
    }
  };

  // 发送 prompt
  const sendPrompt = async (content: string) => {
    const sessionId = store.sessionId();
    if (!sessionId) {
      eventLogger.error("Cannot send prompt: No session ID");
      setError("No session ID");
      return;
    }

    eventLogger.info("Sending prompt", { sessionId, contentLength: content.length });

    // 添加用户消息到 store
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      timestamp: Date.now(),
    };
    store.addMessage(userMessage);
    eventLogger.info("Added user message to store", { messageId: userMessage.id });

    // 确保已连接到事件流
    if (!isConnected()) {
      eventLogger.info("Not connected, connecting to event stream...");
      await connect();
    }

    try {
      eventLogger.info("Sending prompt to server", { sessionId });
      const response = await apiCall(`/sessions/${sessionId}/prompt`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        throw new Error(err.error || `Failed to send prompt: ${response.status}`);
      }

      eventLogger.info("Prompt sent successfully, waiting for stream...");
      // 不要断开重连，保持现有连接来接收流式事件
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      eventLogger.error("Failed to send prompt", { error: errorMessage });
      setError(errorMessage);
      store.setError(errorMessage);
    }
  };

  // 创建新会话
  const createSession = async (): Promise<string> => {
    try {
      const response = await apiCall("/sessions", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status}`);
      }

      const session = await response.json() as { id: string; title?: string };
      store.setSessionId(session.id);
      store.setSessionTitle(session.title || null);
      store.clearMessages();
      
      return session.id;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      throw err;
    }
  };

  // 加载历史消息
  const loadMessages = async (sessionId: string) => {
    try {
      const response = await apiCall(`/sessions/${sessionId}/messages`);
      
      if (!response.ok) {
        throw new Error(`Failed to load messages: ${response.status}`);
      }

      const messages = await response.json() as Message[];
      store.setMessages(messages);
      
      // Initialize parts for each message
      const initialParts: Record<string, MessagePart[]> = {};
      for (const msg of messages) {
        initialParts[msg.id] = [];
      }
      store.setParts(initialParts);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // 清理
  onCleanup(() => {
    disconnect();
  });

  const value: EventStreamContextValue = {
    url,
    setUrl,
    isConnected,
    error,
    connect,
    disconnect,
    sendPrompt,
    createSession,
    loadMessages,
  };

  return (
    <EventStreamContext.Provider value={value}>
      {props.children}
    </EventStreamContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useEventStream(): EventStreamContextValue {
  const context = useContext(EventStreamContext);
  if (!context) {
    throw new Error("useEventStream must be used within an EventStreamProvider");
  }
  return context;
}

export type { EventStreamContext };
