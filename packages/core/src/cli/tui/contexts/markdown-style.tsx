/**
 * @fileoverview Markdown Style Context
 *
 * Provides Markdown rendering SyntaxStyle (created at TUI runtime via OpenTUI)
 * Based on OpenCode's implementation: SyntaxStyle.fromTheme()
 */

import { createContext, useContext, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import { SyntaxStyle, resolveRenderLib } from "@opentui/core";
import { useTheme } from "./theme.js";
import { generateMarkdownSyntax } from "../lib/markdown-syntax.js";

export interface MarkdownStyleContextValue {
  syntaxStyle: Accessor<SyntaxStyle | null>;
}

const MarkdownStyleContext = createContext<MarkdownStyleContextValue | null>(null);

// Re-export for backward compatibility
export { generateMarkdownSyntax };

export function MarkdownStyleProvider(props: { children: unknown }) {
  const theme = useTheme();

  // 直接使用 createMemo，不通过 createSignal 中转
  const syntaxStyle = createMemo(() => {
    try {
      // Check if render lib is available (only in TUI environment)
      const lib = resolveRenderLib();
      if (!lib) {
        console.debug("[MarkdownStyle] render lib not available");
        return null;
      }

      const t = theme.theme();
      
      // Use SyntaxStyle.fromTheme() like OpenCode does
      const rules = generateMarkdownSyntax(t);
      const s = SyntaxStyle.fromTheme(rules);

      // Verify the style has getStyle method
      if (typeof (s as { getStyle?: unknown }).getStyle !== "function") {
        console.warn("[MarkdownStyle] SyntaxStyle.fromTheme() did not return a valid instance (no getStyle)");
        return null;
      }

      console.debug("[MarkdownStyle] Created SyntaxStyle instance:", {
        hasGetStyle: typeof s.getStyle === "function",
        type: s.constructor.name,
      });

      return s;
    } catch (e) {
      console.warn("[MarkdownStyle] Failed to create SyntaxStyle:", e);
      return null;
    }
  });

  const value: MarkdownStyleContextValue = { syntaxStyle };

  return (
    <MarkdownStyleContext.Provider value={value}>
      {props.children as never}
    </MarkdownStyleContext.Provider>
  );
}

export function useMarkdownStyle(): MarkdownStyleContextValue {
  const ctx = useContext(MarkdownStyleContext);
  if (!ctx) {
    throw new Error("useMarkdownStyle must be used within MarkdownStyleProvider");
  }
  return ctx;
}
