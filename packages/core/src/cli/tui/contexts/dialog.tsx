/**
 * @fileoverview Dialog Context - Dialog 栈管理上下文
 * 
 * 提供 Dialog 的显示、隐藏、替换等管理能力
 * 参考 OpenCode 的 Dialog 机制实现
 */

import { createContext, useContext, createSignal, For, Show, type JSX } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import { tuiLogger } from "../logger.js";

// ============================================================================
// 类型定义
// ============================================================================

export interface DialogItem {
  id: string;
  element: () => JSX.Element;  // 改为函数，延迟创建 JSX
  onClose?: () => void;
  title?: string;
}

export interface DialogContextValue {
  // State
  stack: Accessor<DialogItem[]>;
  isOpen: Accessor<boolean>;
  currentDialog: Accessor<DialogItem | null>;

  // Actions
  push: (element: () => JSX.Element, options?: { onClose?: () => void; title?: string }) => void;
  replace: (element: () => JSX.Element, options?: { onClose?: () => void; title?: string }) => void;
  pop: () => void;
  clear: () => void;
  close: (id?: string) => void;
}

// ============================================================================
// Context 定义
// ============================================================================

const DialogContext = createContext<DialogContextValue>();

// ============================================================================
// Provider 组件
// ============================================================================

export function DialogProvider(props: { children: JSX.Element }) {
  const [stack, setStack] = createSignal<DialogItem[]>([]);

  // 计算属性
  const isOpen = () => stack().length > 0;
  const currentDialog = () => stack().at(-1) || null;

  // 生成唯一 ID
  let idCounter = 0;
  const generateId = () => `dialog-${++idCounter}-${Date.now()}`;

  // 推入新 Dialog
  const push = (element: () => JSX.Element, options?: { onClose?: () => void; title?: string }) => {
    const id = generateId();
    tuiLogger.info("[DialogContext] Pushing dialog", { id, title: options?.title });
    
    setStack((prev) => [
      ...prev,
      {
        id,
        element,
        onClose: options?.onClose,
        title: options?.title,
      },
    ]);
  };

  // 替换当前 Dialog（清空栈并推入新内容）
  const replace = (element: () => JSX.Element, options?: { onClose?: () => void; title?: string }) => {
    tuiLogger.info("[DialogContext] Replacing dialog", { title: options?.title });
    
    // 先关闭所有现有 Dialog
    const currentStack = stack();
    for (const item of currentStack) {
      if (item.onClose) {
        try {
          item.onClose();
        } catch (err) {
          tuiLogger.warn("[DialogContext] Error calling onClose", { error: String(err) });
        }
      }
    }
    
    // 清空栈并推入新内容
    const id = generateId();
    setStack([
      {
        id,
        element,
        onClose: options?.onClose,
        title: options?.title,
      },
    ]);
  };

  // 弹出栈顶 Dialog
  const pop = () => {
    const current = stack().at(-1);
    if (current) {
      tuiLogger.info("[DialogContext] Popping dialog", { id: current.id });
      if (current.onClose) {
        try {
          current.onClose();
        } catch (err) {
          tuiLogger.warn("[DialogContext] Error calling onClose", { error: String(err) });
        }
      }
      setStack((prev) => prev.slice(0, -1));
    }
  };

  // 清空所有 Dialog
  const clear = () => {
    tuiLogger.info("[DialogContext] Clearing all dialogs");
    
    const currentStack = stack();
    for (const item of currentStack) {
      if (item.onClose) {
        try {
          item.onClose();
        } catch (err) {
          tuiLogger.warn("[DialogContext] Error calling onClose", { error: String(err) });
        }
      }
    }
    
    setStack([]);
  };

  // 关闭指定 Dialog
  const close = (id?: string) => {
    if (!id) {
      // 如果没有指定 id，关闭栈顶
      pop();
      return;
    }

    tuiLogger.info("[DialogContext] Closing dialog", { id });
    
    const item = stack().find((d) => d.id === id);
    if (item?.onClose) {
      try {
        item.onClose();
      } catch (err) {
        tuiLogger.warn("[DialogContext] Error calling onClose", { error: String(err) });
      }
    }
    
    setStack((prev) => prev.filter((d) => d.id !== id));
  };

  const value: DialogContextValue = {
    stack,
    isOpen,
    currentDialog,
    push,
    replace,
    pop,
    clear,
    close,
  };

  return (
    <DialogContext.Provider value={value}>
      {props.children}
    </DialogContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useDialog(): DialogContextValue {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error("useDialog must be used within a DialogProvider");
  }
  return context;
}

export type { DialogContext };
