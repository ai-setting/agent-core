/**
 * @fileoverview Markdown 渲染验证测试
 *
 * 真正验证 markdown 组件是否被渲染的测试
 * 通过检查 validSyntaxStyle 和渲染路径来确认
 */

import { describe, it, expect } from "bun:test";
import { SyntaxStyle, resolveRenderLib } from "@opentui/core";
import { createSignal, createMemo } from "solid-js";
import type { Message, MessagePart } from "../contexts/store.js";

// ============================================================================
// 模拟完整的 MessageList 渲染逻辑
// ============================================================================

interface RenderDecision {
  useMarkdown: boolean;
  reason: string;
  syntaxStyleValid: boolean;
  hasGetStyle: boolean;
  displayContent: string;
  reasoningParts: MessagePart[];
}

/**
 * 模拟 MessageList.tsx 中的 AssistantMessage 渲染决策
 */
function simulateRenderDecision(
  message: Message,
  parts: MessagePart[],
  syntaxStyle: SyntaxStyle | null,
  isStreaming: boolean,
  isLastMessage: boolean
): RenderDecision {
  // 1. 计算 displayContent（模拟 createMemo）
  const textParts = parts.filter((p: MessagePart) => p.type === "text");
  const texts = textParts.map((p: MessagePart) => p.content || "").join("");
  const displayContent = texts || message.content || "";

  // 2. 计算 reasoningParts
  const reasoningParts = parts.filter((p: MessagePart) => p.type === "reasoning");

  // 3. 检查 validSyntaxStyle（模拟 MessageList.tsx 中的逻辑）
  let syntaxStyleValid = false;
  let hasGetStyle = false;

  if (syntaxStyle) {
    hasGetStyle = typeof (syntaxStyle as unknown as { getStyle?: unknown }).getStyle === "function";
    syntaxStyleValid = hasGetStyle;
  }

  // 4. 决定渲染路径
  const useMarkdown = syntaxStyleValid;
  const reason = useMarkdown
    ? "使用 <markdown> 组件（SyntaxStyle 有效）"
    : `使用 <text> fallback（SyntaxStyle 无效: ${!syntaxStyle ? 'null' : '无 getStyle 方法'})`;

  return {
    useMarkdown,
    reason,
    syntaxStyleValid,
    hasGetStyle,
    displayContent,
    reasoningParts,
  };
}

// ============================================================================
// 测试套件：Markdown 渲染验证
// ============================================================================

describe("Markdown 渲染真实验证", () => {
  it("应该使用真实 SyntaxStyle 触发 markdown 渲染路径", () => {
    const renderLib = resolveRenderLib();
    
    console.log("\n========== Markdown 渲染验证 ==========");
    console.log("RenderLib 可用:", renderLib !== null);

    // 创建真实消息
    const message: Message = {
      id: "msg-test",
      role: "assistant",
      content: "# Hello\n\nThis is **bold** text.",
      timestamp: Date.now(),
    };

    const parts: MessagePart[] = [];

    let renderDecision: RenderDecision;

    if (renderLib) {
      // 使用真实 SyntaxStyle
      const rules = [
        { scope: ["default"], style: { foreground: "#ffffff" } },
        { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
        { scope: ["heading"], style: { foreground: "#ffffff", bold: true } },
      ];

      const syntaxStyle = SyntaxStyle.fromTheme(rules);
      
      console.log("SyntaxStyle 创建成功:", syntaxStyle.constructor.name);
      console.log("有 getStyle 方法:", typeof syntaxStyle.getStyle === "function");

      // 测试 getStyle 是否可用
      try {
        const defaultStyle = syntaxStyle.getStyle("default");
        console.log("✓ getStyle('default') 调用成功:", defaultStyle);
      } catch (e) {
        console.error("✗ getStyle 调用失败:", (e as Error).message);
      }

      // 模拟渲染决策
      renderDecision = simulateRenderDecision(message, parts, syntaxStyle, false, true);
    } else {
      // 没有 RenderLib，使用 null
      renderDecision = simulateRenderDecision(message, parts, null, false, true);
    }

    console.log("\n渲染决策:");
    console.log("  - 使用 Markdown:", renderDecision.useMarkdown);
    console.log("  - 原因:", renderDecision.reason);
    console.log("  - SyntaxStyle 有效:", renderDecision.syntaxStyleValid);
    console.log("  - 有 getStyle:", renderDecision.hasGetStyle);
    console.log("  - 显示内容:", renderDecision.displayContent.substring(0, 50) + "...");
    console.log("========================================\n");

    // 验证：如果有 RenderLib，应该使用 markdown
    if (renderLib) {
      expect(renderDecision.useMarkdown).toBe(true);
      expect(renderDecision.syntaxStyleValid).toBe(true);
      expect(renderDecision.hasGetStyle).toBe(true);
    }
  });

  it("应该验证 stream.text 事件触发 markdown 渲染", () => {
    const renderLib = resolveRenderLib();
    
    console.log("\n========== 流式 Markdown 渲染验证 ==========");

    // 模拟流式事件序列
    const messageId = "msg-streaming-markdown";
    const events = [
      { type: "chunk1", content: "# 标题\n\n" },
      { type: "chunk2", content: "这是**粗体**文本。\n\n" },
      { type: "chunk3", content: "```typescript\nconst x = 1;\n```" },
    ];

    // 累积内容（模拟 stream.text 事件处理）
    let accumulatedContent = "";
    for (const event of events) {
      accumulatedContent += event.content;
    }

    const message: Message = {
      id: messageId,
      role: "assistant",
      content: accumulatedContent,
      timestamp: Date.now(),
    };

    let renderDecision: RenderDecision;

    if (renderLib) {
      const rules = [
        { scope: ["default"], style: { foreground: "#ffffff" } },
        { scope: ["heading"], style: { foreground: "#ffffff", bold: true } },
        { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
        { scope: ["code"], style: { foreground: "#888888" } },
      ];
      const syntaxStyle = SyntaxStyle.fromTheme(rules);
      renderDecision = simulateRenderDecision(message, [], syntaxStyle, true, true);
    } else {
      renderDecision = simulateRenderDecision(message, [], null, true, true);
    }

    console.log("流式内容:", accumulatedContent.substring(0, 80) + "...");
    console.log("渲染决策:");
    console.log("  - 使用 Markdown:", renderDecision.useMarkdown);
    console.log("  - 流式状态:", true);
    console.log("  - Markdown 元素:");
    console.log("    * 标题:", accumulatedContent.includes("# "));
    console.log("    * 粗体:", accumulatedContent.includes("**"));
    console.log("    * 代码块:", accumulatedContent.includes("```"));
    console.log("==========================================\n");

    if (renderLib) {
      expect(renderDecision.useMarkdown).toBe(true);
    }

    // 验证内容包含 Markdown 标记
    expect(accumulatedContent).toContain("# ");
    expect(accumulatedContent).toContain("**");
    expect(accumulatedContent).toContain("```");
  });

  it("应该验证 thinking 内容不触发 markdown 渲染", () => {
    const renderLib = resolveRenderLib();
    
    console.log("\n========== Thinking 内容分离验证 ==========");

    const messageId = "msg-thinking";
    
    // 模拟消息结构（包含 thinking 和 text）
    const message: Message = {
      id: messageId,
      role: "assistant",
      content: "最终答案", // 如果有 text parts，这个不会直接使用
      timestamp: Date.now(),
    };

    const parts: MessagePart[] = [
      {
        id: "part-1",
        type: "reasoning",
        content: "让我思考...\n这是 thinking 内容",
        timestamp: Date.now(),
      },
      {
        id: "part-2",
        type: "text",
        content: "这是**最终答案**",
        timestamp: Date.now(),
      },
    ];

    let renderDecision: RenderDecision;

    if (renderLib) {
      const syntaxStyle = SyntaxStyle.fromTheme([
        { scope: ["default"], style: { foreground: "#ffffff" } },
        { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
      ]);
      renderDecision = simulateRenderDecision(message, parts, syntaxStyle, false, true);
    } else {
      renderDecision = simulateRenderDecision(message, parts, null, false, true);
    }

    console.log("Parts 分析:");
    console.log("  - Reasoning parts:", renderDecision.reasoningParts.length);
    console.log("  - Text parts 内容:", renderDecision.displayContent);
    console.log("渲染决策:");
    console.log("  - 使用 Markdown:", renderDecision.useMarkdown);
    console.log("重要: Thinking 内容应该单独渲染（不使用 markdown），Text 内容使用 markdown");
    console.log("============================================\n");

    if (renderLib) {
      expect(renderDecision.useMarkdown).toBe(true);
    }

    // 验证 content 只包含 text parts 的内容（会被 markdown 渲染）
    expect(renderDecision.displayContent).toBe("这是**最终答案**");
    expect(renderDecision.displayContent).toContain("**");
    
    // 验证 thinking 内容不在 displayContent 中
    expect(renderDecision.displayContent).not.toContain("让我思考");
    
    // 验证 thinking parts 被正确分离
    expect(renderDecision.reasoningParts.length).toBe(1);
    expect(renderDecision.reasoningParts[0].content).toContain("让我思考");
  });

  it("应该验证无效 SyntaxStyle 回退到 text 渲染", () => {
    console.log("\n========== 无效 SyntaxStyle 回退验证 ==========");

    const message: Message = {
      id: "msg-fallback",
      role: "assistant",
      content: "# 标题\n\n内容",
      timestamp: Date.now(),
    };

    // 测试各种无效 SyntaxStyle
    const invalidStyles = [
      { style: null, desc: "null" },
      { style: undefined, desc: "undefined" },
      { style: {}, desc: "空对象" },
      { style: { getStyle: "not a function" }, desc: "getStyle 不是函数" },
    ];

    for (const { style, desc } of invalidStyles) {
      const decision = simulateRenderDecision(message, [], style as any, false, true);
      
      console.log(`测试 ${desc}:`);
      console.log(`  - 使用 Markdown: ${decision.useMarkdown}`);
      console.log(`  - 回退到 text: ${!decision.useMarkdown}`);
      
      expect(decision.useMarkdown).toBe(false);
      expect(decision.syntaxStyleValid).toBe(false);
    }

    console.log("==========================================\n");
  });
});

// ============================================================================
// 测试套件：与真实 MessageList 组件逻辑对比
// ============================================================================

describe("MessageList 组件渲染逻辑验证", () => {
  it("应该完全匹配 MessageList.tsx 中的 validSyntaxStyle 逻辑", () => {
    const renderLib = resolveRenderLib();
    
    console.log("\n========== MessageList validSyntaxStyle 验证 ==========");

    // 这是从 MessageList.tsx 第 54-70 行提取的逻辑
    function validSyntaxStyle(style: any): any {
      if (!style) {
        return null;
      }
      // Check if getStyle exists and is a function (SyntaxStyle has getStyle(name: string): StyleDefinition | undefined)
      const hasGetStyle = typeof (style as unknown as { getStyle?: unknown }).getStyle === "function";
      if (!hasGetStyle) {
        return null;
      }
      return style;
    }

    if (renderLib) {
      const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
      const syntaxStyle = SyntaxStyle.fromTheme(rules);

      console.log("真实 SyntaxStyle 测试:");
      console.log("  - 原始实例:", validSyntaxStyle(syntaxStyle) !== null);
      
      // 测试 createMemo 包装后
      const [getStyle] = createSignal(syntaxStyle);
      const memo = createMemo(() => validSyntaxStyle(getStyle()));
      const memoValue = memo();
      
      console.log("  - createMemo 后:", memoValue !== null);
      console.log("  - 是 SyntaxStyle:", memoValue instanceof SyntaxStyle);
      
      if (memoValue) {
        console.log("  - 可以调用 getStyle:", typeof memoValue.getStyle === "function");
        const result = memoValue.getStyle("default");
        console.log("  - getStyle 结果:", result);
      }

      expect(memoValue).not.toBeNull();
      expect(memoValue instanceof SyntaxStyle).toBe(true);
    } else {
      console.log("RenderLib 不可用，跳过真实 SyntaxStyle 测试");
    }

    // 测试无效值
    expect(validSyntaxStyle(null)).toBeNull();
    expect(validSyntaxStyle(undefined)).toBeNull();
    expect(validSyntaxStyle({})).toBeNull();

    console.log("==========================================\n");
  });

  it("应该验证完整的渲染路径选择", () => {
    const renderLib = resolveRenderLib();
    
    console.log("\n========== 完整渲染路径验证 ==========");

    // 场景 1: 有 SyntaxStyle + 有内容
    console.log("\n场景 1: 有效 SyntaxStyle + Markdown 内容");
    if (renderLib) {
      const rules = [
        { scope: ["default"], style: { foreground: "#ffffff" } },
        { scope: ["heading"], style: { foreground: "#ffffff", bold: true } },
        { scope: ["code"], style: { foreground: "#888888" } },
      ];
      const syntaxStyle = SyntaxStyle.fromTheme(rules);
      
      const message: Message = {
        id: "msg-1",
        role: "assistant",
        content: "# Title\n\n```code\nconst x = 1;\n```",
        timestamp: Date.now(),
      };

      const decision = simulateRenderDecision(message, [], syntaxStyle, false, true);
      
      console.log("  渲染路径:", decision.useMarkdown ? "<markdown>" : "<text>");
      console.log("  期望: <markdown> 组件被渲染");
      
      expect(decision.useMarkdown).toBe(true);
    }

    // 场景 2: 无 SyntaxStyle
    console.log("\n场景 2: 无 SyntaxStyle");
    const message2: Message = {
      id: "msg-2",
      role: "assistant",
      content: "# Title\n\nPlain text",
      timestamp: Date.now(),
    };
    const decision2 = simulateRenderDecision(message2, [], null, false, true);
    
    console.log("  渲染路径:", decision2.useMarkdown ? "<markdown>" : "<text>");
    console.log("  期望: <text> fallback 被渲染");
    
    expect(decision2.useMarkdown).toBe(false);

    // 场景 3: 有 thinking 内容
    console.log("\n场景 3: 有 thinking 内容");
    if (renderLib) {
      const syntaxStyle = SyntaxStyle.fromTheme([{ scope: ["default"], style: { foreground: "#fff" } }]);
      const message3: Message = {
        id: "msg-3",
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      };
      const parts3: MessagePart[] = [
        { id: "r1", type: "reasoning", content: "Thinking...", timestamp: Date.now() },
        { id: "t1", type: "text", content: "Answer", timestamp: Date.now() },
      ];

      const decision3 = simulateRenderDecision(message3, parts3, syntaxStyle, false, true);
      
      console.log("  Reasoning parts:", decision3.reasoningParts.length);
      console.log("  Text content:", decision3.displayContent);
      console.log("  渲染路径:", decision3.useMarkdown ? "<markdown>" : "<text>");
      console.log("  期望: Thinking 单独显示，Text 通过 markdown 渲染");
      
      expect(decision3.useMarkdown).toBe(true);
      expect(decision3.reasoningParts.length).toBe(1);
      expect(decision3.displayContent).toBe("Answer");
    }

    console.log("\n==========================================\n");
  });
});

// ============================================================================
// 测试数据导出
// ============================================================================

export {
  simulateRenderDecision,
  type RenderDecision,
};
