/**
 * @fileoverview Markdown Style Context
 *
 * Provides Markdown rendering SyntaxStyle (created at TUI runtime via OpenTUI)
 * Based on OpenCode's implementation: SyntaxStyle.fromTheme()
 */

import { createContext, useContext, createSignal, createMemo, createEffect } from "solid-js";
import type { Accessor } from "solid-js";
import { SyntaxStyle, resolveRenderLib, type RGBA } from "@opentui/core";
import { useTheme } from "./theme.js";

export interface MarkdownStyleContextValue {
  syntaxStyle: Accessor<SyntaxStyle | null>;
}

const MarkdownStyleContext = createContext<MarkdownStyleContextValue | null>(null);

// ThemeTokenStyle type from OpenTUI
interface ThemeTokenStyle {
  scope: string[];
  style: {
    foreground?: RGBA;
    background?: RGBA;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    dim?: boolean;
  };
}

function generateMarkdownSyntax(theme: any): ThemeTokenStyle[] {
  // Don't call parseColor here - convertThemeToStyles will call it
  // Just pass the hex color strings directly
  return [
    {
      scope: ["default"],
      style: {
        foreground: theme.foreground,
      },
    },
    {
      scope: ["markup.strong"],
      style: {
        foreground: theme.foreground,
        bold: true,
      },
    },
    {
      scope: ["markup.italic"],
      style: {
        foreground: theme.thinking,
        italic: true,
      },
    },
    {
      scope: ["markup.raw"],
      style: {
        foreground: theme.muted,
      },
    },
    {
      scope: ["heading", "heading.1", "heading.2", "heading.3", "heading.4", "heading.5", "heading.6"],
      style: {
        foreground: theme.foreground,
        bold: true,
      },
    },
    {
      scope: ["markup.list"],
      style: {
        foreground: theme.foreground,
      },
    },
    {
      scope: ["markup.quote"],
      style: {
        foreground: theme.muted,
      },
    },
    {
      scope: ["link", "markup.link"],
      style: {
        foreground: theme.primary,
      },
    },
    {
      scope: ["code", "markup.raw.block"],
      style: {
        foreground: theme.muted,
      },
    },
    {
      scope: ["comment"],
      style: {
        foreground: theme.muted,
        italic: true,
      },
    },
  ];
}

export function MarkdownStyleProvider(props: { children: unknown }) {
  const theme = useTheme();
  const [syntaxStyle, setSyntaxStyle] = createSignal<SyntaxStyle | null>(null);

  // Use createMemo to create the syntax style reactively
  const style = createMemo(() => {
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

      return s;
    } catch (e) {
      console.warn("[MarkdownStyle] Failed to create SyntaxStyle:", e);
      return null;
    }
  });

  // Update the signal when style changes
  createEffect(() => {
    setSyntaxStyle(style());
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
