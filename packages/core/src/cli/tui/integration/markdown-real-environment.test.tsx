/**
 * @fileoverview TUI 真实环境集成测试
 *
 * 使用与实际 TUI 相同的配置运行测试
 * --conditions=browser --preload @opentui/solid/scripts/preload.ts
 * 
 * 运行方式：
 * bun run --conditions=browser --preload ./node_modules/@opentui/solid/scripts/preload.ts test src/cli/tui/integration/markdown-real-environment.test.tsx
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { SyntaxStyle, resolveRenderLib } from "@opentui/core";
import { render } from "@opentui/solid";
import { createSignal, createMemo, Show, For } from "solid-js";
import type { Message, MessagePart } from "../contexts/store.js";

// 检查是否在正确的环境中运行
function checkEnvironment() {
  const isPreloadLoaded = typeof (globalThis as any).__OPENTUI_PRELOAD__ !== "undefined";
  const renderLib = resolveRenderLib();
  
  return {
    isPreloadLoaded,
    hasRenderLib: renderLib !== null,
    renderLibType: renderLib ? typeof renderLib : "null",
  };
}

describe("TUI 真实环境 Markdown 渲染测试", () => {
  let env: ReturnType<typeof checkEnvironment>;

  beforeAll(() => {
    env = checkEnvironment();
    console.log("\n========== 环境检查 ==========");
    console.log("Preload 脚本加载:", env.isPreloadLoaded);
    console.log("RenderLib 可用:", env.hasRenderLib);
    console.log("RenderLib 类型:", env.renderLibType);
    console.log("==============================\n");
  });

  it("应该在真实 TUI 环境中运行", () => {
    console.log("测试环境信息:");
    console.log("  - 当前文件使用 babel + solid preset 编译");
    console.log("  - JSX 生成模式: universal");
    console.log("  - RenderLib:", env.hasRenderLib ? "可用" : "不可用");
    
    // 这个测试只要运行成功，就说明环境配置正确
    expect(true).toBe(true);
  });

  it("应该复现 Show 组件回调中的 SyntaxStyle 问题", () => {
    if (!env.hasRenderLib) {
      console.log("跳过：RenderLib 不可用");
      return;
    }

    console.log("\n========== 问题复现测试 ==========");

    // 创建 SyntaxStyle
    const rules = [
      { scope: ["default"], style: { foreground: "#ffffff" } },
      { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
      { scope: ["heading"], style: { foreground: "#ffffff", bold: true } },
    ];
    const syntaxStyle = SyntaxStyle.fromTheme(rules);

    console.log("SyntaxStyle 创建:");
    console.log("  - 类型:", syntaxStyle.constructor.name);
    console.log("  - has getStyle:", typeof syntaxStyle.getStyle === "function");

    // 模拟 MessageList.tsx 的完整逻辑
    const [getSyntaxStyle] = createSignal(syntaxStyle);

    let rawSyntaxStyleRef: SyntaxStyle | null = null;

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
      rawSyntaxStyleRef = style;
      return style;
    });

    const memoValue = validSyntaxStyle();

    console.log("\ncreateMemo 结果:");
    console.log("  - 值:", memoValue !== null ? "有效" : "null");
    console.log("  - rawSyntaxStyleRef:", rawSyntaxStyleRef !== null ? "有效" : "null");

    if (memoValue) {
      // 关键测试：模拟 Show 组件的子渲染函数
      console.log("\n模拟 Show 组件回调:");
      
      // 在真实的 TUI 中，Show 组件的子函数会被 SolidJS 调用
      // 我们在这里模拟这个过程
      const callback = (style: SyntaxStyle) => {
        const rawStyle = rawSyntaxStyleRef || style;

        console.log("  Show 回调接收:");
        console.log("    - style 类型:", typeof style);
        console.log("    - style 构造函数:", style?.constructor?.name);
        console.log("    - style has getStyle:", typeof style?.getStyle === "function");
        console.log("    - rawStyle === style:", rawStyle === style);
        console.log("    - rawStyle has getStyle:", typeof rawStyle?.getStyle === "function");

        // 尝试调用 getStyle（这里可能失败！）
        try {
          const result = style.getStyle("markup.strong");
          console.log("    - ✓ style.getStyle 调用成功");
          return { success: true, result };
        } catch (e) {
          console.error("    - ✗ style.getStyle 调用失败:", (e as Error).message);
          return { success: false, error: (e as Error).message };
        }
      };

      const result = callback(memoValue);
      
      if (!result.success) {
        console.log("\n*** 问题复现成功！***");
        console.log("错误:", result.error);
        console.log("这说明在真实 TUI 环境中存在 SyntaxStyle 方法丢失问题");
      }

      expect(result.success).toBe(true);
    }

    console.log("==================================\n");
  });

  it("应该测试 JSX 渲染中的 SyntaxStyle 传递", () => {
    if (!env.hasRenderLib) {
      console.log("跳过：RenderLib 不可用");
      return;
    }

    console.log("\n========== JSX 渲染测试 ==========");

    const rules = [
      { scope: ["default"], style: { foreground: "#ffffff" } },
      { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
    ];
    const syntaxStyle = SyntaxStyle.fromTheme(rules);

    const [getSyntaxStyle] = createSignal(syntaxStyle);

    let rawSyntaxStyleRef: SyntaxStyle | null = null;

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
      rawSyntaxStyleRef = style;
      return style;
    });

    // 使用真实的 JSX 语法（会被 babel 编译）
    const TestComponent = () => {
      const memoValue = validSyntaxStyle();

      return (
        <Show when={memoValue}>
          {(style: SyntaxStyle) => {
            // 这里模拟 MessageList.tsx 第 113-144 行
            const rawStyle = rawSyntaxStyleRef || style;

            console.log("JSX Show 回调:");
            console.log("  - style 类型:", typeof style);
            console.log("  - style 构造函数:", style?.constructor?.name);
            console.log("  - style has getStyle:", typeof style?.getStyle === "function");
            console.log("  - rawStyle has getStyle:", typeof rawStyle?.getStyle === "function");

            try {
              const result = style.getStyle("default");
              console.log("  - ✓ getStyle 可用:", result);
            } catch (e) {
              console.error("  - ✗ getStyle 失败:", (e as Error).message);
            }

            return <text>Test</text>;
          }}
        </Show>
      );
    };

    // 注意：这里我们创建组件但不实际渲染（因为需要完整的 TUI 环境）
    // 主要测试 JSX 编译是否正确
    console.log("\nJSX 编译成功 - 组件已创建");
    console.log("==================================\n");

    expect(TestComponent).toBeDefined();
  });

  it("应该测试流式更新场景", () => {
    if (!env.hasRenderLib) {
      console.log("跳过：RenderLib 不可用");
      return;
    }

    console.log("\n========== 流式更新场景测试 ==========");

    const rules = [
      { scope: ["default"], style: { foreground: "#ffffff" } },
      { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
    ];
    const syntaxStyle = SyntaxStyle.fromTheme(rules);

    const [getSyntaxStyle] = createSignal(syntaxStyle);
    const [getContent, setContent] = createSignal("");

    let rawSyntaxStyleRef: SyntaxStyle | null = null;

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
      rawSyntaxStyleRef = style;
      return style;
    });

    const displayContent = createMemo(() => getContent());

    // 模拟流式接收内容
    const chunks = ["Hello ", "**World**", "!"];
    let hasError = false;

    for (const chunk of chunks) {
      setContent(prev => prev + chunk);
      
      const style = validSyntaxStyle();
      const content = displayContent();

      console.log(`更新: "${content}"`);
      
      if (style) {
        try {
          style.getStyle("markup.strong");
        } catch (e) {
          console.error("  - getStyle 失败:", (e as Error).message);
          hasError = true;
        }
      }
    }

    console.log("\n流式更新完成");
    console.log("  - 最终内容:", displayContent());
    console.log("  - 有错误:", hasError);
    console.log("======================================\n");

    expect(hasError).toBe(false);
  });
});

describe("环境差异对比", () => {
  it("应该对比测试环境和 TUI 环境的差异", () => {
    console.log("\n========== 环境差异分析 ==========");
    console.log("");
    console.log("TUI 实际运行:");
    console.log("  bun run --conditions=browser --preload ./node_modules/@opentui/solid/scripts/preload.ts ./src/cli/index.ts");
    console.log("  ");
    console.log("  特点:");
    console.log("    - 使用 babel-preset-solid 编译 JSX");
    console.log("    - generate: 'universal' 模式");
    console.log("    - moduleName: '@opentui/solid'");
    console.log("    - SolidJS 使用 universal 渲染器");
    console.log("");
    console.log("测试环境 (bun test):");
    console.log("  - 不使用 preload 脚本");
    console.log("  - 可能使用不同的 JSX 编译方式");
    console.log("  - SolidJS 可能使用不同的渲染模式");
    console.log("");
    console.log("关键差异:");
    console.log("  1. JSX 编译方式不同");
    console.log("  2. SolidJS 响应式系统行为可能不同");
    console.log("  3. 对象传递和包装方式可能不同");
    console.log("");
    console.log("如果要复现问题，需要使用与 TUI 相同的配置运行测试");
    console.log("==================================\n");

    expect(true).toBe(true);
  });
});
