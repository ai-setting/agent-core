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
  
  // Setters
  setSessionId: Setter<string | null>;
  setSessionTitle: Setter<string | null>;
  setMessages: Setter<Message[]>;
  setParts: Setter<Record<string, MessagePart[]>>;
  setIsStreaming: Setter<boolean>;
  setIsConnected: Setter<boolean>;
  setStatus: Setter<string>;
  setError: Setter<string | null>;
  
  // Actions
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
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

  // Actions
  const addMessage = (message: Message) => {
    console.log("[STORE] addMessage called", { id: message.id, role: message.role, contentLength: message.content?.length });
    batch(() => {
      setMessages(prev => {
        const newMessages = [...prev, message];
        console.log("[STORE] addMessage completed", { messagesCount: newMessages.length });
        return newMessages;
      });
      if (!parts()[message.id]) {
        setParts(prev => {
          console.log("[STORE] initialize parts for message", { messageId: message.id });
          return { ...prev, [message.id]: [] };
        });
      }
    });
  };

  const updateMessage = (id: string, updates: Partial<Message>) => {
    console.log("[STORE] updateMessage", { id, updates: Object.keys(updates) });
    setMessages(prev =>
      prev.map(msg => (msg.id === id ? { ...msg, ...updates } : msg))
    );
  };

  const addPart = (messageId: string, part: MessagePart) => {
    console.log("[STORE] addPart", { messageId, partType: part.type, partContentLength: part.content?.length });
    batch(() => {
      setParts(prev => {
        const currentParts = prev[messageId] || [];
        const newParts = [...currentParts, part];
        console.log("[STORE] addPart completed", { messageId, partsCount: newParts.length });
        return {
          ...prev,
          [messageId]: newParts,
        };
      });
    });
  };

  const updatePart = (messageId: string, partId: string, updates: Partial<MessagePart>) => {
    console.log("[STORE] updatePart", { messageId, partId, updates: Object.keys(updates) });
    setParts(prev => ({
      ...prev,
      [messageId]: (prev[messageId] || []).map(p =>
        p.id === partId ? { ...p, ...updates } : p
      ),
    }));
  };

  const clearMessages = () => {
    console.log("[STORE] clearMessages");
    batch(() => {
      setMessages([]);
      setParts({});
      setError(null);
    });
  };

  const appendMessageContent = (messageId: string, delta: string) => {
    console.log("[STORE] appendMessageContent", { messageId, deltaLength: delta.length, deltaPreview: delta.substring(0, 50) });
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
    setSessionId,
    setSessionTitle,
    setMessages,
    setParts,
    setIsStreaming,
    setIsConnected,
    setStatus,
    setError,
    addMessage,
    updateMessage,
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
