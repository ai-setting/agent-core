import { RGBA } from "@opentui/core";

export interface ThemeTokenStyle {
  scope: string[];
  style: {
    foreground?: RGBA | string;
    background?: RGBA | string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    dim?: boolean;
  };
}

export interface MarkdownTheme {
  foreground: string;
  background?: string;
  primary: string;
  secondary?: string;
  muted: string;
  thinking: string;
  border?: string;
  success?: string;
  warning?: string;
  error?: string;
  accent?: string;
}

export function generateMarkdownSyntax(theme: MarkdownTheme): ThemeTokenStyle[] {
  return [
    {
      scope: ["default"],
      style: {
        foreground: theme.foreground,
      },
    },
    {
      scope: ["markup.heading"],
      style: {
        foreground: theme.primary,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.1"],
      style: {
        foreground: theme.primary,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.2"],
      style: {
        foreground: theme.primary,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.3"],
      style: {
        foreground: theme.primary,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.4"],
      style: {
        foreground: theme.primary,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.5"],
      style: {
        foreground: theme.primary,
        bold: true,
      },
    },
    {
      scope: ["markup.heading.6"],
      style: {
        foreground: theme.primary,
        bold: true,
      },
    },
    {
      scope: ["markup.bold", "markup.strong"],
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
      scope: ["markup.list"],
      style: {
        foreground: theme.primary,
      },
    },
    {
      scope: ["markup.quote"],
      style: {
        foreground: theme.muted,
        italic: true,
      },
    },
    {
      scope: ["markup.raw", "markup.raw.block"],
      style: {
        foreground: theme.muted,
      },
    },
    {
      scope: ["markup.raw.inline"],
      style: {
        foreground: theme.muted,
      },
    },
    {
      scope: ["markup.link"],
      style: {
        foreground: theme.primary,
        underline: true,
      },
    },
    {
      scope: ["markup.link.label"],
      style: {
        foreground: theme.primary,
        underline: true,
      },
    },
    {
      scope: ["markup.link.url"],
      style: {
        foreground: theme.muted,
        underline: true,
      },
    },
    {
      scope: ["markup.strikethrough"],
      style: {
        foreground: theme.muted,
      },
    },
    {
      scope: ["markup.underline"],
      style: {
        foreground: theme.foreground,
        underline: true,
      },
    },
    {
      scope: ["markup.list.checked"],
      style: {
        foreground: theme.success || theme.primary,
      },
    },
    {
      scope: ["markup.list.unchecked"],
      style: {
        foreground: theme.muted,
      },
    },
    {
      scope: ["code"],
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
