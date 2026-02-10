/**
 * @fileoverview Markdown 语法高亮失效问题复现测试
 *
 * 复现 TUI 中看到的原始 markdown 内容问题：
 * - **内容** 应该渲染为加粗，但实际显示为原始文本
 * - 错误: this._syntaxStyle.getStyle is not a function
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { SyntaxStyle, resolveRenderLib } from "@opentui/core";
import { createSignal, createMemo, untrack, batch } from "solid-js";
import type { Message, MessagePart } from "../contexts/store.js";

describe("Markdown 语法高亮失效问题复现", () => {
  it("应该复现 Show 组件回调中 SyntaxStyle 方法丢失", () => {
    const renderLib = resolveRenderLib();
    if (!renderLib) {
      console.log("RenderLib 不可用，跳过此测试");
      return;
    }

    console.log("\n========== 问题复现: Show 组件回调 ==========");

    // 创建真实 SyntaxStyle
    const rules = [
      { scope: ["default"], style: { foreground: "#ffffff" } },
      { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
      { scope: ["heading"], style: { foreground: "#ffffff", bold: true } },
    ];
    const originalSyntaxStyle = SyntaxStyle.fromTheme(rules);

    console.log("原始 SyntaxStyle:");
    console.log("  - 类型:", typeof originalSyntaxStyle);
    console.log("  - 构造函数:", originalSyntaxStyle.constructor.name);
    console.log("  - has getStyle:", typeof originalSyntaxStyle.getStyle === "function");

    // 模拟 MessageList.tsx 中的 createMemo
    const [getSyntaxStyle] = createSignal(originalSyntaxStyle);

    const validSyntaxStyle = createMemo(() => {
      const style = getSyntaxStyle();
      if (!style) return null;
      if (typeof (style as unknown as { getStyle?: unknown }).getStyle !== "function") {
        return null;
      }
      return style;
    });

    // 模拟 Show 组件的 when 条件
    const memoValue = validSyntaxStyle();
    console.log("\ncreateMemo 结果:");
    console.log("  - 值:", memoValue !== null ? "有效" : "null");
    console.log("  - 类型:", typeof memoValue);

    if (memoValue) {
      // 模拟 Show 组件的子渲染函数
      // Show when={validSyntaxStyle()}>{(style) => ...}</Show>
      console.log("\n模拟 Show 组件回调接收:");
      console.log("  - 参数类型:", typeof memoValue);
      console.log("  - 构造函数:", memoValue.constructor.name);
      console.log("  - has getStyle:", typeof memoValue.getStyle === "function");

      // 尝试调用 getStyle
      try {
        const result = memoValue.getStyle("markup.strong");
        console.log("  - getStyle 调用成功:", result);
      } catch (e) {
        console.error("  - ✗ getStyle 调用失败:", (e as Error).message);
      }
    }

    console.log("============================================\n");

    expect(memoValue).not.toBeNull();
    expect(typeof memoValue?.getStyle).toBe("function");
  });

  it("应该复现传递过程中的 SyntaxStyle 丢失", () => {
    const renderLib = resolveRenderLib();
    if (!renderLib) {
      console.log("RenderLib 不可用，跳过此测试");
      return;
    }

    console.log("\n========== 问题复现: 传递过程 ==========");

    const rules = [
      { scope: ["default"], style: { foreground: "#ffffff" } },
      { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
    ];
    const originalStyle = SyntaxStyle.fromTheme(rules);

    // 模拟 MessageList.tsx 中的 ref 方案
    let rawSyntaxStyleRef: SyntaxStyle | null = null;

    const [getSyntaxStyle] = createSignal(originalStyle);

    const validSyntaxStyle = createMemo(() => {
      const style = getSyntaxStyle();
      if (!style) {
        rawSyntaxStyleRef = null;
        return null;
      }
      const hasGetStyle = typeof (style as unknown as { getStyle?: unknown }).getStyle === "function";
      if (!hasGetStyle) {
        rawSyntaxStyleRef = null;
        return null;
      }
      // 存储原始引用
      rawSyntaxStyleRef = style;
      return style;
    });

    const memoValue = validSyntaxStyle();

    console.log("在 createMemo 中:");
    console.log("  - rawSyntaxStyleRef 设置:", rawSyntaxStyleRef !== null);
    console.log("  - memoValue 返回:", memoValue !== null);

    if (memoValue && rawSyntaxStyleRef) {
      // 模拟 Show 回调
      console.log("\n模拟 Show 回调:");
      
      // 方案 1: 直接使用 memo 返回值
      console.log("方案 1 - 使用 memoValue:");
      console.log("  - 类型:", typeof memoValue);
      console.log("  - has getStyle:", typeof memoValue.getStyle === "function");

      // 方案 2: 使用 ref 中的原始对象（MessageList.tsx 的方式）
      const rawStyle = rawSyntaxStyleRef || memoValue;
      console.log("\n方案 2 - 使用 rawSyntaxStyleRef:");
      console.log("  - rawStyle === memoValue:", rawStyle === memoValue);
      console.log("  - 类型:", typeof rawStyle);
      console.log("  - has getStyle:", typeof rawStyle.getStyle === "function");

      // 关键测试：在 SolidJS 的响应式上下文中传递
      console.log("\n关键测试: 模拟传递给 <markdown> 组件");
      
      // 模拟组件内部接收到的值
      function simulateMarkdownComponent(props: { syntaxStyle: any }) {
        console.log("  <markdown> 组件接收:");
        console.log("    - syntaxStyle 类型:", typeof props.syntaxStyle);
        console.log("    - has getStyle:", typeof props.syntaxStyle?.getStyle === "function");
        console.log("    - 是 SyntaxStyle:", props.syntaxStyle instanceof SyntaxStyle);

        try {
          const result = props.syntaxStyle.getStyle("default");
          console.log("    - ✓ 内部可以调用 getStyle");
          return result;
        } catch (e) {
          console.error("    - ✗ 内部调用 getStyle 失败:", (e as Error).message);
          throw e;
        }
      }

      // 测试传递 ref 中的值
      try {
        simulateMarkdownComponent({ syntaxStyle: rawStyle });
      } catch (e) {
        console.error("传递失败!");
      }
    }

    console.log("============================================\n");
  });

  it("应该复现 batch 更新中的 SyntaxStyle 问题", () => {
    const renderLib = resolveRenderLib();
    if (!renderLib) {
      console.log("RenderLib 不可用，跳过此测试");
      return;
    }

    console.log("\n========== 问题复现: batch 更新 ==========");

    const rules = [
      { scope: ["default"], style: { foreground: "#ffffff" } },
      { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
    ];
    const originalStyle = SyntaxStyle.fromTheme(rules);

    const [getSyntaxStyle, setSyntaxStyle] = createSignal(originalStyle);
    const [getContent, setContent] = createSignal("");

    // 模拟流式更新
    console.log("模拟流式更新...");
    
    let errorCaught: Error | null = null;
    
    try {
      batch(() => {
        // 模拟多个 stream.text 事件
        for (let i = 0; i < 3; i++) {
          setContent(prev => prev + `chunk${i} `);
          // 确保 style 信号也被访问
          const style = getSyntaxStyle();
          console.log(`  batch 内 chunk${i}: style.getStyle 可用 =`, typeof style?.getStyle === "function");
        }
      });
    } catch (e) {
      errorCaught = e as Error;
      console.error("batch 更新错误:", (e as Error).message);
    }

    // batch 后检查
    const finalStyle = getSyntaxStyle();
    console.log("\nbatch 后:");
    console.log("  - style 类型:", typeof finalStyle);
    console.log("  - has getStyle:", typeof finalStyle?.getStyle === "function");

    if (finalStyle && typeof finalStyle.getStyle === "function") {
      try {
        const result = finalStyle.getStyle("markup.strong");
        console.log("  - getStyle 调用成功");
      } catch (e) {
        console.error("  - getStyle 调用失败:", (e as Error).message);
      }
    }

    console.log("============================================\n");

    expect(errorCaught).toBeNull();
  });

  it("应该测试 content 更新时的响应式追踪", () => {
    const renderLib = resolveRenderLib();
    if (!renderLib) {
      console.log("RenderLib 不可用，跳过此测试");
      return;
    }

    console.log("\n========== content 更新时的追踪 ==========");

    const rules = [
      { scope: ["default"], style: { foreground: "#ffffff" } },
      { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
    ];
    const originalStyle = SyntaxStyle.fromTheme(rules);

    const [getSyntaxStyle] = createSignal(originalStyle);
    const [getContent, setContent] = createSignal("");

    // 模拟完整的渲染逻辑
    const validSyntaxStyle = createMemo(() => {
      const style = getSyntaxStyle();
      if (!style) return null;
      return typeof (style as unknown as { getStyle?: unknown }).getStyle === "function" ? style : null;
    });

    const displayContent = createMemo(() => {
      return getContent();
    });

    console.log("测试 content 更新:");
    const contents = ["Hello ", "**World**", "!"];
    
    for (const chunk of contents) {
      setContent(prev => prev + chunk);
      
      const style = validSyntaxStyle();
      const content = displayContent();
      
      console.log(`  内容: "${content}"`);
      console.log(`    - style 可用: ${style !== null}`);
      console.log(`    - has getStyle: ${style ? typeof style.getStyle === "function" : false}`);

      if (style) {
        try {
          style.getStyle("markup.strong");
          console.log(`    - ✓ getStyle 可用`);
        } catch (e) {
          console.error(`    - ✗ getStyle 失败:`, (e as Error).message);
        }
      }
    }

    console.log("\n最终内容:", displayContent());
    console.log("包含 Markdown 标记:", displayContent().includes("**"));
    console.log("============================================\n");
  });

  it("应该验证 untrack 方案的效果", () => {
    const renderLib = resolveRenderLib();
    if (!renderLib) {
      console.log("RenderLib 不可用，跳过此测试");
      return;
    }

    console.log("\n========== untrack 方案验证 ==========");

    const rules = [
      { scope: ["default"], style: { foreground: "#ffffff" } },
    ];
    const originalStyle = SyntaxStyle.fromTheme(rules);

    const [getSyntaxStyle] = createSignal(originalStyle);

    // 不使用 untrack
    const withoutUntrack = getSyntaxStyle();
    console.log("不使用 untrack:");
    console.log("  - 类型:", typeof withoutUntrack);
    console.log("  - has getStyle:", typeof withoutUntrack.getStyle === "function");

    // 使用 untrack
    const withUntrack = untrack(() => getSyntaxStyle());
    console.log("\n使用 untrack:");
    console.log("  - 类型:", typeof withUntrack);
    console.log("  - has getStyle:", typeof withUntrack.getStyle === "function");
    console.log("  - 相同对象:", withoutUntrack === withUntrack);

    // 测试 createMemo + untrack 组合
    const memoWithUntrack = createMemo(() => {
      return untrack(() => {
        const style = getSyntaxStyle();
        if (!style) return null;
        return typeof (style as unknown as { getStyle?: unknown }).getStyle === "function" ? style : null;
      });
    });

    const result = memoWithUntrack();
    console.log("\ncreateMemo + untrack:");
    console.log("  - 结果:", result !== null ? "有效" : "null");
    console.log("  - has getStyle:", result ? typeof result.getStyle === "function" : false);

    console.log("============================================\n");
  });
});

// ============================================================================
// 测试：真实渲染场景
// ============================================================================

describe("真实 Markdown 渲染场景", () => {
  it("应该测试带加粗文本的完整渲染流程", () => {
    const renderLib = resolveRenderLib();
    if (!renderLib) {
      console.log("RenderLib 不可用，跳过此测试");
      return;
    }

    console.log("\n========== 加粗文本渲染测试 ==========");

    const rules = [
      { scope: ["default"], style: { foreground: "#cccccc" } },
      { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
      { scope: ["heading"], style: { foreground: "#ffffff", bold: true } },
    ];
    const syntaxStyle = SyntaxStyle.fromTheme(rules);

    const markdownContent = `# 标题

这是**加粗文本**和普通文本。

\`\`\`typescript
const code = "highlighted";
\`\`\``;

    console.log("Markdown 内容:");
    console.log(markdownContent);
    console.log("\n语法规则:");
    console.log("  - default:", rules[0].style);
    console.log("  - markup.strong:", rules[1].style);

    // 验证 SyntaxStyle 可以解析这些标记
    console.log("\n样式解析测试:");
    const defaultStyle = syntaxStyle.getStyle("default");
    const strongStyle = syntaxStyle.getStyle("markup.strong");
    
    console.log("  - default 样式:", defaultStyle);
    console.log("  - strong 样式:", strongStyle);

    if (strongStyle) {
      console.log("  - strong 有 bold:", strongStyle.bold === true);
    }

    console.log("\n期望在 TUI 中看到:");
    console.log("  - 标题: 加粗显示");
    console.log("  - **加粗文本**: 加粗显示");
    console.log("  - 普通文本: 正常显示");
    console.log("  - 代码块: 特殊颜色");

    console.log("============================================\n");

    expect(syntaxStyle.getStyle("markup.strong")).toBeDefined();
  });

  it("应该分析问题根本原因", () => {
    console.log("\n========== 问题根本原因分析 ==========");
    console.log("");
    console.log("问题描述:");
    console.log("  TUI 中显示原始 markdown 内容，如：**内容创作**");
    console.log("  期望：显示为加粗的「内容创作」");
    console.log("  实际：显示为 **内容创作**");
    console.log("");
    console.log("错误信息:");
    console.log("  this._syntaxStyle.getStyle is not a function");
    console.log("");
    console.log("问题分析:");
    console.log("  1. <markdown> 组件被渲染了（不是 fallback）");
    console.log("  2. 但组件内部接收到的 syntaxStyle 不正确");
    console.log("  3. this._syntaxStyle 是 undefined 或没有 getStyle 方法");
    console.log("  4. 导致 markdown 无法被解析，显示原始内容");
    console.log("");
    console.log("可能原因:");
    console.log("  A. SolidJS 响应式追踪导致对象在传递时被替换");
    console.log("  B. Show 组件的子渲染函数参数被包装");
    console.log("  C. SyntaxStyle 实例在 JSX 属性传递时丢失方法");
    console.log("");
    console.log("需要检查:");
    console.log("  - MessageList.tsx 第 115 行的 rawSyntaxStyleRef 是否真的存储了原始对象");
    console.log("  - Show 回调的 style 参数和 rawStyle 是否一致");
    console.log("  - 传递给 <markdown> 的 syntaxStyle 在组件内部是否有效");
    console.log("============================================\n");

    expect(true).toBe(true);
  });
});
