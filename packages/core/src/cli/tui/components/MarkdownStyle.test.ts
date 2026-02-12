/**
 * @fileoverview MarkdownStyle Context 单元测试
 *
 * 测试 Markdown 样式生成逻辑
 */

import { describe, it, expect } from "bun:test";
import { generateMarkdownSyntax, type ThemeTokenStyle, type MarkdownTheme } from "../lib/markdown-syntax.js";

// ============================================================================
// 测试数据构造
// ============================================================================

/**
 * 构造测试主题
 */
function createTestTheme(overrides?: Partial<MarkdownTheme>): MarkdownTheme {
  return {
    foreground: "#ffffff",
    primary: "#3b82f6",
    muted: "#6b7280",
    thinking: "#a855f7",
    ...overrides,
  };
}

// ============================================================================
// 测试场景 1: 主题规则生成
// ============================================================================

describe("MarkdownStyle 规则生成", () => {
  it("应该为默认文本生成规则", () => {
    const theme = createTestTheme({ foreground: "#ffffff" });
    const rules = generateMarkdownSyntax(theme);

    const defaultRule = rules.find(r => r.scope.includes("default"));
    expect(defaultRule).toBeDefined();
    expect(defaultRule?.style.foreground).toBe("#ffffff");
  });

  it("应该为粗体文本生成规则", () => {
    const theme = createTestTheme({ foreground: "#ffffff" });
    const rules = generateMarkdownSyntax(theme);

    const boldRule = rules.find(r => r.scope.includes("markup.strong"));
    expect(boldRule).toBeDefined();
    expect(boldRule?.style.bold).toBe(true);
    expect(boldRule?.style.foreground).toBe("#ffffff");
  });

  it("应该为斜体文本生成规则", () => {
    const theme = createTestTheme({ thinking: "#a855f7" });
    const rules = generateMarkdownSyntax(theme);

    const italicRule = rules.find(r => r.scope.includes("markup.italic"));
    expect(italicRule).toBeDefined();
    expect(italicRule?.style.italic).toBe(true);
    expect(italicRule?.style.foreground).toBe("#a855f7");
  });

  it("应该为行内代码生成规则", () => {
    const theme = createTestTheme({ muted: "#6b7280" });
    const rules = generateMarkdownSyntax(theme);

    const codeRule = rules.find(r => r.scope.includes("markup.raw"));
    expect(codeRule).toBeDefined();
    expect(codeRule?.style.foreground).toBe("#6b7280");
  });

  it("应该为标题生成规则", () => {
    const theme = createTestTheme({ foreground: "#ffffff" });
    const rules = generateMarkdownSyntax(theme);

    const headingRules = rules.filter(r => 
      r.scope.some(s => s.startsWith("heading"))
    );

    expect(headingRules.length).toBeGreaterThan(0);
    
    // 所有标题都应该有粗体样式
    for (const rule of headingRules) {
      expect(rule.style.bold).toBe(true);
      expect(rule.style.foreground).toBe("#ffffff");
    }
  });

  it("应该为列表生成规则", () => {
    const theme = createTestTheme({ foreground: "#ffffff" });
    const rules = generateMarkdownSyntax(theme);

    const listRule = rules.find(r => r.scope.includes("markup.list"));
    expect(listRule).toBeDefined();
    expect(listRule?.style.foreground).toBe("#ffffff");
  });

  it("应该为引用生成规则", () => {
    const theme = createTestTheme({ muted: "#6b7280" });
    const rules = generateMarkdownSyntax(theme);

    const quoteRule = rules.find(r => r.scope.includes("markup.quote"));
    expect(quoteRule).toBeDefined();
    expect(quoteRule?.style.foreground).toBe("#6b7280");
  });

  it("应该为链接生成规则", () => {
    const theme = createTestTheme({ primary: "#3b82f6" });
    const rules = generateMarkdownSyntax(theme);

    const linkRules = rules.filter(r => 
      r.scope.includes("link") || r.scope.includes("markup.link")
    );

    expect(linkRules.length).toBeGreaterThan(0);
    
    for (const rule of linkRules) {
      expect(rule.style.foreground).toBe("#3b82f6");
    }
  });

  it("应该为代码块生成规则", () => {
    const theme = createTestTheme({ muted: "#6b7280" });
    const rules = generateMarkdownSyntax(theme);

    const codeBlockRule = rules.find(r => 
      r.scope.includes("code") || r.scope.includes("markup.raw.block")
    );

    expect(codeBlockRule).toBeDefined();
    expect(codeBlockRule?.style.foreground).toBe("#6b7280");
  });

  it("应该为注释生成规则", () => {
    const theme = createTestTheme({ muted: "#6b7280" });
    const rules = generateMarkdownSyntax(theme);

    const commentRule = rules.find(r => r.scope.includes("comment"));
    expect(commentRule).toBeDefined();
    expect(commentRule?.style.italic).toBe(true);
    expect(commentRule?.style.foreground).toBe("#6b7280");
  });
});

// ============================================================================
// 测试场景 2: 主题颜色变化
// ============================================================================

describe("MarkdownStyle 主题颜色变化", () => {
  it("应该使用不同的前景色", () => {
    const darkTheme = createTestTheme({ foreground: "#ffffff" });
    const lightTheme = createTestTheme({ foreground: "#1a1a1a" });

    const darkRules = generateMarkdownSyntax(darkTheme);
    const lightRules = generateMarkdownSyntax(lightTheme);

    const darkDefault = darkRules.find(r => r.scope.includes("default"));
    const lightDefault = lightRules.find(r => r.scope.includes("default"));

    expect(darkDefault?.style.foreground).toBe("#ffffff");
    expect(lightDefault?.style.foreground).toBe("#1a1a1a");
  });

  it("应该使用不同的主色调", () => {
    const blueTheme = createTestTheme({ primary: "#3b82f6" });
    const greenTheme = createTestTheme({ primary: "#22c55e" });

    const blueRules = generateMarkdownSyntax(blueTheme);
    const greenRules = generateMarkdownSyntax(greenTheme);

    const blueLink = blueRules.find(r => r.scope.includes("link"));
    const greenLink = greenRules.find(r => r.scope.includes("link"));

    expect(blueLink?.style.foreground).toBe("#3b82f6");
    expect(greenLink?.style.foreground).toBe("#22c55e");
  });
});

// ============================================================================
// 测试场景 3: 规则结构验证
// ============================================================================

describe("MarkdownStyle 规则结构", () => {
  it("所有规则都应该有 scope 数组", () => {
    const theme = createTestTheme();
    const rules = generateMarkdownSyntax(theme);

    for (const rule of rules) {
      expect(Array.isArray(rule.scope)).toBe(true);
      expect(rule.scope.length).toBeGreaterThan(0);
    }
  });

  it("所有规则都应该有 style 对象", () => {
    const theme = createTestTheme();
    const rules = generateMarkdownSyntax(theme);

    for (const rule of rules) {
      expect(typeof rule.style).toBe("object");
      expect(rule.style).not.toBeNull();
    }
  });

  it("应该生成多个规则", () => {
    const theme = createTestTheme();
    const rules = generateMarkdownSyntax(theme);

    // 至少应该有 default, strong, italic, raw, heading, list, quote, link, code, comment
    expect(rules.length).toBeGreaterThanOrEqual(9);
  });

  it("标题规则应该包含多个 heading 范围", () => {
    const theme = createTestTheme();
    const rules = generateMarkdownSyntax(theme);

    const headingRule = rules.find(r => 
      r.scope.includes("heading") && r.scope.includes("heading.1")
    );

    expect(headingRule).toBeDefined();
    expect(headingRule?.scope.length).toBeGreaterThan(1);
    expect(headingRule?.scope).toContain("heading");
    expect(headingRule?.scope).toContain("heading.1");
    expect(headingRule?.scope).toContain("heading.2");
    expect(headingRule?.scope).toContain("heading.3");
  });
});

// ============================================================================
// 测试场景 4: Markdown 内容匹配
// ============================================================================

describe("MarkdownStyle 内容匹配", () => {
  it("规则应该覆盖常见的 Markdown 元素", () => {
    const theme = createTestTheme();
    const rules = generateMarkdownSyntax(theme);

    // 收集所有 scope
    const allScopes = rules.flatMap(r => r.scope);

    // 验证关键的 Markdown scope 存在
    expect(allScopes).toContain("default");
    expect(allScopes).toContain("markup.strong");
    expect(allScopes).toContain("markup.italic");
    expect(allScopes).toContain("markup.raw");
    expect(allScopes).toContain("heading");
    expect(allScopes).toContain("markup.list");
    expect(allScopes).toContain("markup.quote");
    expect(allScopes).toContain("link");
    expect(allScopes).toContain("code");
    expect(allScopes).toContain("comment");
  });

  it("粗体和斜体应该有不同的样式", () => {
    const theme = createTestTheme();
    const rules = generateMarkdownSyntax(theme);

    const boldRule = rules.find(r => r.scope.includes("markup.strong"));
    const italicRule = rules.find(r => r.scope.includes("markup.italic"));

    expect(boldRule?.style.bold).toBe(true);
    expect(italicRule?.style.italic).toBe(true);
  });

  it("代码块和引用都应该使用 muted 颜色", () => {
    const theme = createTestTheme({ muted: "#6b7280" });
    const rules = generateMarkdownSyntax(theme);

    const codeBlockRule = rules.find(r => r.scope.includes("markup.raw.block"));
    const quoteRule = rules.find(r => r.scope.includes("markup.quote"));

    expect(codeBlockRule?.style.foreground).toBe("#6b7280");
    expect(quoteRule?.style.foreground).toBe("#6b7280");
  });
});

// ============================================================================
// 测试场景 5: 边界情况
// ============================================================================

describe("MarkdownStyle 边界情况", () => {
  it("应该处理不完整的主题对象", () => {
    const incompleteTheme = {
      foreground: "#ffffff",
      // 缺少其他属性
    };

    // @ts-expect-error
    const rules = generateMarkdownSyntax(incompleteTheme);
    
    // 应该仍然生成规则，即使某些值是 undefined
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0].scope).toContain("default");
  });

  it("应该处理空字符串颜色值", () => {
    const themeWithEmptyColor = createTestTheme({ 
      foreground: "",
      primary: "", 
    });

    const rules = generateMarkdownSyntax(themeWithEmptyColor);
    
    // 应该生成规则，但颜色值为空字符串
    const defaultRule = rules.find(r => r.scope.includes("default"));
    expect(defaultRule).toBeDefined();
  });

  it("应该处理特殊颜色格式", () => {
    const theme = createTestTheme({
      foreground: "rgb(255, 255, 255)",
      primary: "hsl(210, 100%, 50%)",
    });

    const rules = generateMarkdownSyntax(theme);
    
    // 应该保留原始颜色字符串（由 SyntaxStyle 负责解析）
    const defaultRule = rules.find(r => r.scope.includes("default"));
    expect(defaultRule?.style.foreground).toBe("rgb(255, 255, 255)");
  });
});

// ============================================================================
// 辅助函数导出
// ============================================================================

export { createTestTheme };
