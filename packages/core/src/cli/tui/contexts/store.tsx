/**
 * @fileoverview Store Context - 状态管理
 * 
 * 基于 SolidJS 的 createContext 实现全局状态管理
 * 参考 OpenCode 的设计模式
 */

import { createContext, useContext, createSignal, createEffect, batch } from "solid-js";
import type { Accessor, Setter } from "solid-js";

// ============================================================================
// 类型定义
// ============================================================================

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  parts?: MessagePart[];
}

export interface MessagePart {
  id: string;
  type: "text" | "reasoning" | "tool_call" | "tool_result";
  content?: string;
  delta?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: unknown;
  success?: boolean;
  timestamp?: number;
}

export interface Session {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreState {
  sessionId: string | null;
  sessionTitle: string | null;
  messages: Message[];
  parts: Record<string, MessagePart[]>;
  isStreaming: boolean;
  isConnected: boolean;
  status: string;
  error: string | null;
  lastModelName: string | null;
  lastResponseTimeMs: number | null;
}

// ============================================================================
// Context 定义
// ============================================================================

export interface StoreContextValue {
  // State
  sessionId: Accessor<string | null>;
  sessionTitle: Accessor<string | null>;
  messages: Accessor<Message[]>;
  parts: Accessor<Record<string, MessagePart[]>>;
  isStreaming: Accessor<boolean>;
  isConnected: Accessor<boolean>;
  status: Accessor<string>;
  error: Accessor<string | null>;
  lastModelName: Accessor<string | null>;
  lastResponseTimeMs: Accessor<number | null>;

  // Setters
  setSessionId: Setter<string | null>;
  setSessionTitle: Setter<string | null>;
  setMessages: Setter<Message[]>;
  setParts: Setter<Record<string, MessagePart[]>>;
  setIsStreaming: Setter<boolean>;
  setIsConnected: Setter<boolean>;
  setStatus: Setter<string>;
  setError: Setter<string | null>;
  setLastModelName: Setter<string | null>;
  setLastResponseTimeMs: Setter<number | null>;
  
  // Actions
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  moveMessageToEnd: (messageId: string) => void;
  addPart: (messageId: string, part: MessagePart) => void;
  updatePart: (messageId: string, partId: string, updates: Partial<MessagePart>) => void;
  clearMessages: () => void;
  appendMessageContent: (messageId: string, delta: string) => void;
}

const StoreContext = createContext<StoreContextValue>();

// ============================================================================
// Provider 组件
// ============================================================================

export function StoreProvider(props: { children: any }) {
  // 创建响应式状态
  const [sessionId, setSessionId] = createSignal<string | null>(null);
  const [sessionTitle, setSessionTitle] = createSignal<string | null>(null);
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [parts, setParts] = createSignal<Record<string, MessagePart[]>>({});
  const [isStreaming, setIsStreaming] = createSignal(false);
  const [isConnected, setIsConnected] = createSignal(false);
  const [status, setStatus] = createSignal("Ready");
  const [error, setError] = createSignal<string | null>(null);
  const [lastModelName, setLastModelName] = createSignal<string | null>(null);
  const [lastResponseTimeMs, setLastResponseTimeMs] = createSignal<number | null>(null);

  // Actions
  const addMessage = (message: Message) => {
    batch(() => {
      setMessages(prev => [...prev, message]);
      if (!parts()[message.id]) {
        setParts(prev => ({ ...prev, [message.id]: [] }));
      }
    });
  };

  const moveMessageToEnd = (messageId: string) => {
    setMessages(prev => {
      const message = prev.find(m => m.id === messageId);
      if (!message) return prev;
      return [...prev.filter(m => m.id !== messageId), message];
    });
  };

  const updateMessage = (id: string, updates: Partial<Message>) => {
    setMessages(prev =>
      prev.map(msg => (msg.id === id ? { ...msg, ...updates } : msg))
    );
  };

  const addPart = (messageId: string, part: MessagePart) => {
    batch(() => {
      setParts(prev => ({
        ...prev,
        [messageId]: [...(prev[messageId] || []), part],
      }));
    });
  };

  const updatePart = (messageId: string, partId: string, updates: Partial<MessagePart>) => {
    setParts(prev => ({
      ...prev,
      [messageId]: (prev[messageId] || []).map(p =>
        p.id === partId ? { ...p, ...updates } : p
      ),
    }));
  };

  const clearMessages = () => {
    batch(() => {
      setMessages([]);
      setParts({});
      setError(null);
    });
  };

  const appendMessageContent = (messageId: string, delta: string) => {
    // 参数验证
    if (!messageId) {
      console.warn("[Store] appendMessageContent called with empty messageId");
      return;
    }
    if (typeof delta !== "string") {
      console.warn("[Store] appendMessageContent called with non-string delta:", typeof delta, delta);
      return;
    }
    
    setMessages(prev =>
      prev.map(msg =>
        msg.id === messageId
          ? { ...msg, content: msg.content + delta }
          : msg
      )
    );
  };

  const value: StoreContextValue = {
    sessionId,
    sessionTitle,
    messages,
    parts,
    isStreaming,
    isConnected,
    status,
    error,
    lastModelName,
    lastResponseTimeMs,
    setSessionId,
    setSessionTitle,
    setMessages,
    setParts,
    setIsStreaming,
    setIsConnected,
    setStatus,
    setError,
    setLastModelName,
    setLastResponseTimeMs,
    addMessage,
    updateMessage,
    moveMessageToEnd,
    addPart,
    updatePart,
    clearMessages,
    appendMessageContent,
  };

  return (
    <StoreContext.Provider value={value}>
      {props.children}
    </StoreContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useStore(): StoreContextValue {
  const context = useContext(StoreContext);
  if (!context) {
    throw new Error("useStore must be used within a StoreProvider");
  }
  return context;
}

export type { StoreContext };
