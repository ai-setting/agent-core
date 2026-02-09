/**
 * @fileoverview Theme Context - 主题管理
 * 
 * 提供亮色/暗色主题支持
 */

import { createContext, useContext, createSignal } from "solid-js";
import type { Accessor, Setter } from "solid-js";

// ============================================================================
// 主题类型定义
// ============================================================================

export interface Theme {
  name: string;
  background: string;
  foreground: string;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  muted: string;
  border: string;
  userMessage: string;
  assistantMessage: string;
  thinking: string;
  toolCall: string;
  toolResult: string;
}

export const themes: Record<string, Theme> = {
  dark: {
    name: "dark",
    background: "#1a1a2e",
    foreground: "#eaeaea",
    primary: "#3b7dd8",
    secondary: "#6c757d",
    success: "#28a745",
    warning: "#ffc107",
    error: "#dc3545",
    muted: "#6c757d",
    border: "#2d2d44",
    userMessage: "#4ade80",
    assistantMessage: "#60a5fa",
    thinking: "#9ca3af",
    toolCall: "#fbbf24",
    toolResult: "#34d399",
  },
  light: {
    name: "light",
    background: "#ffffff",
    foreground: "#1a1a2e",
    primary: "#3b7dd8",
    secondary: "#6c757d",
    success: "#28a745",
    warning: "#ffc107",
    error: "#dc3545",
    muted: "#6c757d",
    border: "#dee2e6",
    userMessage: "#16a34a",
    assistantMessage: "#2563eb",
    thinking: "#6b7280",
    toolCall: "#d97706",
    toolResult: "#059669",
  },
};

// ============================================================================
// Context 定义
// ============================================================================

export interface ThemeContextValue {
  theme: Accessor<Theme>;
  setTheme: Setter<Theme>;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>();

// ============================================================================
// Provider 组件
// ============================================================================

export function ThemeProvider(props: { children: any; initialMode?: "dark" | "light" }) {
  const initialTheme = themes[props.initialMode || "dark"];
  const [theme, setTheme] = createSignal<Theme>(initialTheme);

  const toggleTheme = () => {
    setTheme(current => (current.name === "dark" ? themes.light : themes.dark));
  };

  const value: ThemeContextValue = {
    theme,
    setTheme,
    toggleTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      {props.children}
    </ThemeContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}

export type { ThemeContext };
