/**
 * @fileoverview 真实 TUI 场景复现测试
 *
 * 这个测试尝试复现实际 TUI 运行时的 SyntaxStyle 问题
 * 使用真实的 OpenTUI 组件和 SolidJS 组合
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { createSignal, createMemo, createEffect, batch, onCleanup } from "solid-js";
import { render } from "@opentui/solid";
import { SyntaxStyle, resolveRenderLib, CliRenderer } from "@opentui/core";

describe("真实 TUI 场景 - SyntaxStyle 丢失问题复现", () => {
  it("应该复现 batch 更新时 SyntaxStyle 方法丢失", async () => {
    // 创建 SyntaxStyle
    const rules = [{ scope: ["default"], style: { foreground: "#ffffff" } }];
    const syntaxStyle = SyntaxStyle.fromTheme(rules);

    console.log("\n========== 测试 1: 基础 SyntaxStyle ==========");
    console.log("创建实例:", syntaxStyle.constructor.name);
    console.log("有 getStyle:", typeof syntaxStyle.getStyle === "function");

    // 创建响应式 signal
    const [getStyle, setStyle] = createSignal<SyntaxStyle | null>(syntaxStyle);
    const [getContent, setContent] = createSignal("");

    // 模拟 EventStream 的 batch 更新
    console.log("\n========== 测试 2: Batch 更新场景 ==========");

    let errorCaught: Error | null = null;

    // 模拟事件处理中的 batch
    try {
      batch(() => {
        // 模拟 stream.start
        setStyle(syntaxStyle);

        // 模拟多个 stream.text 事件
        for (let i = 0; i < 5; i++) {
          setContent(prev => prev + `chunk-${i} `);
        }
      });
    } catch (e) {
      errorCaught = e as Error;
      console.error("Batch 更新错误:", (e as Error).message);
    }

    const currentStyle = getStyle();
    console.log("Batch 后 style 类型:", typeof currentStyle);
    console.log("是 SyntaxStyle:", currentStyle instanceof SyntaxStyle);
    console.log("有 getStyle:", currentStyle && typeof currentStyle.getStyle === "function");

    if (currentStyle && typeof currentStyle.getStyle === "function") {
      try {
        const result = currentStyle.getStyle("default");
        console.log("✓ getStyle 调用成功");
      } catch (e) {
        console.error("✗ getStyle 调用失败:", (e as Error).message);
        errorCaught = e as Error;
      }
    }

    console.log("============================================\n");

    expect(errorCaught).toBeNull();
  });

  it("应该测试 createMemo + Show 组合", () => {
    const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
    const [getStyle] = createSignal(SyntaxStyle.fromTheme(rules));

    // 模拟 MessageList 中的 validSyntaxStyle
    const validSyntaxStyle = createMemo(() => {
      const style = getStyle();
      if (!style) return null;
      if (typeof style.getStyle !== "function") {
        console.warn("validSyntaxStyle: getStyle 不是函数!");
        return null;
      }
      return style;
    });

    // 获取 memo 值（这会在 Show 组件的 when 中使用）
    const memoValue = validSyntaxStyle();

    console.log("\n========== 测试 3: createMemo 结果 ==========");
    console.log("Memo 值类型:", typeof memoValue);
    console.log("是 SyntaxStyle:", memoValue instanceof SyntaxStyle);
    console.log("是 null:", memoValue === null);

    if (memoValue) {
      console.log("有 getStyle:", typeof memoValue.getStyle === "function");

      // 模拟 Show 组件的子渲染函数接收到的值
      // Show when={validSyntaxStyle()}>{(style) => ...}</Show>
      const showCallback = (style: any) => {
        console.log("\nShow 回调接收:");
        console.log("  类型:", typeof style);
        console.log("  是 SyntaxStyle:", style instanceof SyntaxStyle);
        console.log("  有 getStyle:", typeof style?.getStyle === "function");

        try {
          style.getStyle("default");
          console.log("  ✓ 可以调用 getStyle");
        } catch (e) {
          console.error("  ✗ 调用 getStyle 失败:", (e as Error).message);
          throw e;
        }
      };

      showCallback(memoValue);
    }

    console.log("============================================\n");

    expect(memoValue).not.toBeNull();
  });

  it("应该测试 SolidJS 响应式追踪", () => {
    const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
    const originalStyle = SyntaxStyle.fromTheme(rules);

    const [getStyle] = createSignal(originalStyle);

    // 创建 effect 来追踪变化
    let effectCallCount = 0;
    let lastStyleInEffect: any = null;

    createEffect(() => {
      effectCallCount++;
      const style = getStyle();
      lastStyleInEffect = style;

      console.log(`\nEffect #${effectCallCount}:`);
      console.log("  类型:", typeof style);
      console.log("  是 SyntaxStyle:", style instanceof SyntaxStyle);
      console.log("  有 getStyle:", style && typeof style.getStyle === "function");

      if (style && typeof style.getStyle === "function") {
        try {
          style.getStyle("default");
          console.log("  ✓ 在 effect 中可以调用 getStyle");
        } catch (e) {
          console.error("  ✗ 在 effect 中调用 getStyle 失败:", (e as Error).message);
        }
      }
    });

    console.log("\n========== 测试 4: Effect 追踪 ==========");
    console.log("Effect 被调用次数:", effectCallCount);
    console.log("Effect 中最后接收的 style:", lastStyleInEffect?.constructor?.name);
    console.log("============================================\n");

    expect(effectCallCount).toBeGreaterThan(0);
  });

  it("应该测试流式更新场景", () => {
    const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
    const [getStyle] = createSignal(SyntaxStyle.fromTheme(rules));
    const [getContent, setContent] = createSignal("");

    const validSyntaxStyle = createMemo(() => {
      const style = getStyle();
      return style && typeof style.getStyle === "function" ? style : null;
    });

    console.log("\n========== 测试 5: 流式更新 ==========");

    // 模拟流式文本更新
    const chunks = ["Hello", " ", "World", "!"];
    let updateCount = 0;

    for (const chunk of chunks) {
      setContent(prev => prev + chunk);
      updateCount++;

      const style = validSyntaxStyle();
      const content = getContent();

      console.log(`更新 #${updateCount}: "${content}"`);
      console.log(`  style 可用:`, style !== null);
      console.log(`  getStyle 可用:`, style && typeof style.getStyle === "function");

      if (style) {
        try {
          style.getStyle("default");
        } catch (e) {
          console.error(`  ✗ 更新 #${updateCount} 时 getStyle 失败:`, (e as Error).message);
        }
      }
    }

    console.log("============================================\n");
    expect(getContent()).toBe("Hello World!");
  });
});

describe("OpenTUI 组件渲染测试", () => {
  it("应该检查 OpenTUI 渲染环境", () => {
    const lib = resolveRenderLib();

    console.log("\n========== OpenTUI 环境检查 ==========");
    console.log("RenderLib 可用:", lib !== null);

    if (lib) {
      console.log("Lib 类型:", typeof lib);
      console.log("有 createCliRenderer:", typeof (lib as any).createCliRenderer === "function");
    }

    console.log("====================================\n");

    // 在测试环境中可能不可用，这是正常的
    expect(typeof lib === "object" || lib === null).toBe(true);
  });

  it("应该验证 SyntaxStyle 在渲染中的行为", () => {
    const rules = [
      { scope: ["default"], style: { foreground: "#ffffff" } },
      { scope: ["heading"], style: { foreground: "#ffffff", bold: true } },
      { scope: ["code"], style: { foreground: "#888888" } },
    ];

    const syntaxStyle = SyntaxStyle.fromTheme(rules);

    console.log("\n========== SyntaxStyle 验证 ==========");
    console.log("实例类型:", syntaxStyle.constructor.name);

    // 测试 getStyle 调用
    const defaultStyle = syntaxStyle.getStyle("default");
    const headingStyle = syntaxStyle.getStyle("heading");
    const codeStyle = syntaxStyle.getStyle("code");

    console.log("default style:", defaultStyle);
    console.log("heading style:", headingStyle);
    console.log("code style:", codeStyle);
    console.log("=====================================\n");

    expect(defaultStyle).toBeDefined();
    expect(headingStyle).toBeDefined();
    expect(codeStyle).toBeDefined();
  });
});

describe("错误场景诊断", () => {
  it("应该记录实际错误信息", () => {
    const realWorldError = {
      message: "this._syntaxStyle.getStyle is not a function",
      stack: [
        "at getStyle (Markdown.ts:136:35)",
        "at createChunk (Markdown.ts:145:24)",
        "at renderInlineToken (Markdown.ts:176:26)",
        "at renderInlineContent (Markdown.ts:169:12)",
        "at renderParagraphChunks (Markdown.ts:327:10)",
      ],
      context: "OpenTUI Markdown 组件内部渲染 Markdown 内容时",
    };

    console.log("\n========== 真实错误分析 ==========");
    console.log("错误信息:", realWorldError.message);
    console.log("错误位置:", realWorldError.stack[0]);
    console.log("上下文:", realWorldError.context);
    console.log("\n问题:");
    console.log("- Markdown 组件内部的 this._syntaxStyle 是 undefined 或没有 getStyle 方法");
    console.log("- 这意味着传递给组件的 syntaxStyle prop 不正确");
    console.log("\n可能原因:");
    console.log("1. SolidJS 响应式追踪导致对象被替换");
    console.log("2. 组件重渲染时 syntaxStyle 变成了 null");
    console.log("3. 传递过程中对象被序列化/反序列化");
    console.log("==================================\n");

    expect(realWorldError.message).toContain("getStyle is not a function");
  });
});
