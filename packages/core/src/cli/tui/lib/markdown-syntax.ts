/**
 * @fileoverview Markdown Syntax Generator
 *
 * 生成 Markdown 渲染所需的语法规则
 * 与 UI 框架无关，可独立测试
 */

// ThemeTokenStyle type from OpenTUI
export interface ThemeTokenStyle {
  scope: string[];
  style: {
    foreground?: string;
    background?: string;
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
  muted: string;
  thinking: string;
  border?: string;
  success?: string;
  error?: string;
}

/**
 * 生成 Markdown 语法高亮规则
 * 
 * 根据主题颜色生成适用于 SyntaxStyle 的规则数组
 * 
 * @param theme - Markdown 主题配置
 * @returns ThemeTokenStyle 规则数组
 */
export function generateMarkdownSyntax(theme: MarkdownTheme): ThemeTokenStyle[] {
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
