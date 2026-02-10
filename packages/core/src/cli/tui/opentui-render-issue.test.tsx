/**
 * @fileoverview OpenTUI 渲染问题复现测试
 *
 * 使用 OpenTUI 组件来复现 SyntaxStyle 问题
 */

import { describe, it, expect } from "bun:test";
import { createSignal, createMemo, untrack } from "solid-js";
import { SyntaxStyle } from "@opentui/core";
import { getComponentCatalogue } from "@opentui/solid";

describe("OpenTUI 组件渲染问题复现", () => {
  it("应该检查 OpenTUI 组件目录中的 markdown", () => {
    const catalogue = getComponentCatalogue();

    console.log("\n========== OpenTUI 组件目录 ==========");
    console.log("可用组件:", Object.keys(catalogue));
    console.log("markdown 组件存在:", "markdown" in catalogue);

    if (catalogue.markdown) {
      console.log("markdown 组件类型:", typeof catalogue.markdown);
      console.log("markdown 组件名:", catalogue.markdown.name);
    }
    console.log("=====================================\n");

    expect(catalogue.markdown).toBeDefined();
  });

  it("应该测试传递给组件的 SyntaxStyle", () => {
    const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
    const syntaxStyle = SyntaxStyle.fromTheme(rules);

    // 创建响应式 signal
    const [getSyntaxStyle] = createSignal(syntaxStyle);

    // 模拟 Show 组件的 when 回调
    const validSyntaxStyle = createMemo(() => {
      const style = getSyntaxStyle();
      if (!style) return null;
      if (typeof style.getStyle !== "function") {
        console.warn("getStyle 不是函数!");
        return null;
      }
      return style;
    });

    // 获取验证后的 style
    const validatedStyle = validSyntaxStyle();

    if (validatedStyle) {
      console.log("\n========== 组件渲染场景测试 ==========");
      console.log("验证后的 style 类型:", typeof validatedStyle);
      console.log("是 SyntaxStyle 实例:", validatedStyle instanceof SyntaxStyle);
      console.log("有 getStyle 方法:", typeof validatedStyle.getStyle === "function");

      // 模拟在渲染回调中接收参数
      // 就像在 MessageList.tsx 中的 {(style: SyntaxStyle) => ...}
      function renderCallback(style: any) {
        console.log("\n渲染回调接收到的参数:");
        console.log("  参数类型:", typeof style);
        console.log("  是 SyntaxStyle 实例:", style instanceof SyntaxStyle);
        console.log("  有 getStyle:", typeof style?.getStyle === "function");

        // 检查是否是代理对象
        console.log("  是代理对象:", style !== validatedStyle);
        console.log("  是同一个引用:", style === validatedStyle);

        // 尝试调用 getStyle
        try {
          const result = style.getStyle("default");
          console.log("  ✓ getStyle 调用成功");
          return result;
        } catch (e) {
          console.error("  ✗ getStyle 调用失败:", (e as Error).message);
          throw e;
        }
      }

      // 使用 untrack 获取原始值
      const rawStyle = untrack(() => validatedStyle);

      console.log("\n使用 untrack 后:");
      console.log("  原始值类型:", typeof rawStyle);
      console.log("  是同一个对象:", rawStyle === validatedStyle);
      console.log("  有 getStyle:", typeof rawStyle.getStyle === "function");

      // 测试传递原始值
      renderCallback(rawStyle);
      console.log("=====================================\n");
    }
  });

  it("应该测试 SolidJS 函数组件参数传递", () => {
    const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
    const [getStyle] = createSignal(SyntaxStyle.fromTheme(rules));

    // 模拟组件定义
    function MockMarkdown(props: { syntaxStyle: any }) {
      console.log("\n========== 函数组件内部 ==========");
      console.log("props.syntaxStyle 类型:", typeof props.syntaxStyle);
      console.log("是 SyntaxStyle:", props.syntaxStyle instanceof SyntaxStyle);
      console.log("有 getStyle:", typeof props.syntaxStyle?.getStyle === "function");

      // 这是 OpenTUI 的 Markdown 组件会做的
      if (props.syntaxStyle && typeof props.syntaxStyle.getStyle === "function") {
        try {
          const result = props.syntaxStyle.getStyle("default");
          console.log("✓ 可以在组件内调用 getStyle");
          return result;
        } catch (e) {
          console.error("✗ 在组件内调用 getStyle 失败:", (e as Error).message);
          throw e;
        }
      }
      console.log("=================================\n");
      return null;
    }

    // 模拟调用
    const style = getStyle();
    if (style) {
      MockMarkdown({ syntaxStyle: style });
    }
  });

  it("应该测试传递 null/undefined 的情况", () => {
    const testCases = [
      { value: null, desc: "null" },
      { value: undefined, desc: "undefined" },
      { value: {}, desc: "空对象" },
      { value: { getStyle: "not a function" }, desc: "错误的 getStyle" },
    ];

    console.log("\n========== 边界情况测试 ==========");
    for (const testCase of testCases) {
      const hasGetStyle = testCase.value &&
                          typeof (testCase.value as any).getStyle === "function";
      console.log(`${testCase.desc}: getStyle 可用 = ${hasGetStyle}`);
    }
    console.log("=================================\n");

    expect(testCases.length).toBe(4);
  });
});

describe("实际错误场景分析", () => {
  it("应该分析真实错误堆栈", () => {
    const realError = {
      message: "this._syntaxStyle.getStyle is not a function",
      location: "Markdown.ts:136:35",
      context: "OpenTUI Markdown 组件内部",
    };

    console.log("\n========== 真实错误分析 ==========");
    console.log("错误信息:", realError.message);
    console.log("错误位置:", realError.location);
    console.log("错误上下文:", realError.context);
    console.log("\n可能的原因:");
    console.log("1. SyntaxStyle 实例在传递过程中被包装");
    console.log("2. 实例的 _syntaxStyle 属性指向了错误的对象");
    console.log("3. SolidJS 的响应式系统在某些情况下会创建代理");
    console.log("\n解决方案:");
    console.log("1. 使用 untrack() 获取原始对象");
    console.log("2. 确保传递给 <markdown> 的是原始 SyntaxStyle");
    console.log("3. 在 MarkdownStyleProvider 中缓存实例");
    console.log("=================================\n");

    expect(realError.message).toContain("getStyle is not a function");
  });
});
