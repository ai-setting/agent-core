/**
 * @fileoverview SolidJS Store for TUI State Management
 * 
 * 参考 OpenCode 设计，实现响应式状态管理
 */

import { createStore } from "solid-js/store";
import type { Message, MessagePart } from "./types";

export interface SessionStore {
  messages: Message[];
  parts: Record<string, MessagePart[]>;  // messageId -> parts
  sessionId?: string;
  isStreaming: boolean;
  status: string;
}

// 创建全局 store
const [store, setStore] = createStore<SessionStore>({
  messages: [],
  parts: {},
  sessionId: undefined,
  isStreaming: false,
  status: "",
});

export { store, setStore };

// Store Actions
export const storeActions = {
  /**
   * 添加消息
   */
  addMessage(message: Message) {
    setStore("messages", (msgs) => [...msgs, message]);
    setStore("parts", message.id, []);
  },

  /**
   * 更新或添加 Part
   * 参考 OpenCode: reconcile part by id
   */
  updatePart(messageId: string, part: MessagePart) {
    setStore("parts", messageId, (parts = []) => {
      const index = parts.findIndex((p) => p.id === part.id);
      if (index >= 0) {
        // 更新现有 part（SolidJS 自动追踪变化）
        return parts.map((p, i) => (i === index ? part : p));
      } else {
        // 新增 part
        return [...parts, part];
      }
    });
  },

  /**
   * 设置会话ID
   */
  setSessionId(sessionId: string) {
    setStore("sessionId", sessionId);
  },

  /**
   * 设置流式状态
   */
  setStreaming(isStreaming: boolean) {
    setStore("isStreaming", isStreaming);
  },

  /**
   * 设置状态文本
   */
  setStatus(status: string) {
    setStore("status", status);
  },

  /**
   * 重置 store
   */
  reset() {
    setStore({
      messages: [],
      parts: {},
      sessionId: undefined,
      isStreaming: false,
      status: "",
    });
  },
};
