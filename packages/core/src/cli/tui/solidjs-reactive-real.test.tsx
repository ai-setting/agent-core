/**
 * @fileoverview SolidJS 响应式问题真实复现测试
 *
 * 使用真实的 SolidJS 来复现 SyntaxStyle 方法丢失问题
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { createSignal, createMemo, untrack } from "solid-js";
import { SyntaxStyle } from "@opentui/core";

describe("真实 SolidJS 响应式问题复现", () => {
  it("应该复现 SyntaxStyle 被响应式包装后方法丢失的问题", () => {
    // 创建真实的 SyntaxStyle 实例
    const rules = [
      { scope: ["default"], style: { foreground: "#ffffff" } },
      { scope: ["heading"], style: { foreground: "#ffffff", bold: true } },
    ];

    const syntaxStyle = SyntaxStyle.fromTheme(rules);

    // 验证原始对象有 getStyle 方法
    expect(typeof syntaxStyle.getStyle).toBe("function");
    console.log("✓ 原始 SyntaxStyle 有 getStyle 方法");

    // 创建 SolidJS Signal
    const [getSyntaxStyle, setSyntaxStyle] = createSignal(syntaxStyle);

    // 从 Signal 获取值（这会被 SolidJS 包装）
    const reactiveStyle = getSyntaxStyle();

    // 检查从 Signal 获取的值是否还有 getStyle 方法
    console.log("Signal 返回值的类型:", typeof reactiveStyle);
    console.log("Signal 返回值有 getStyle 吗:", typeof reactiveStyle.getStyle);

    // 这个测试会帮助我们理解问题
    expect(typeof reactiveStyle).toBe("object");

    // 尝试调用 getStyle - 这里可能会失败
    try {
      const style = reactiveStyle.getStyle("default");
      console.log("✓ 可以直接调用 getStyle:", style);
    } catch (e) {
      console.error("✗ 无法调用 getStyle:", (e as Error).message);
      throw e;
    }
  });

  it("应该验证 createMemo 返回的 SyntaxStyle", () => {
    const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
    const [getSyntaxStyle] = createSignal(SyntaxStyle.fromTheme(rules));

    // 使用 createMemo（就像 MessageList.tsx 中那样）
    const validSyntaxStyle = createMemo(() => {
      const style = getSyntaxStyle();
      if (!style) return null;
      const hasGetStyle = typeof style.getStyle === "function";
      return hasGetStyle ? style : null;
    });

    const memoStyle = validSyntaxStyle();

    console.log("Memo 返回值的类型:", typeof memoStyle);
    console.log("Memo 返回值是 SyntaxStyle 实例吗:", memoStyle instanceof SyntaxStyle);

    // 验证 memo 返回的对象
    expect(memoStyle).not.toBeNull();

    try {
      const result = memoStyle!.getStyle("default");
      console.log("✓ Memo 返回值可以调用 getStyle:", result);
    } catch (e) {
      console.error("✗ Memo 返回值无法调用 getStyle:", (e as Error).message);
      throw e;
    }
  });

  it("应该测试 untrack 是否能获取原始对象", () => {
    const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
    const [getSyntaxStyle] = createSignal(SyntaxStyle.fromTheme(rules));

    // 不使用 untrack
    const withoutUntrack = getSyntaxStyle();

    // 使用 untrack
    const withUntrack = untrack(() => getSyntaxStyle());

    console.log("\n不使用 untrack:");
    console.log("  - 类型:", typeof withoutUntrack);
    console.log("  - getStyle 存在:", typeof withoutUntrack.getStyle === "function");

    console.log("\n使用 untrack:");
    console.log("  - 类型:", typeof withUntrack);
    console.log("  - getStyle 存在:", typeof withUntrack.getStyle === "function");
    console.log("  - 是同一个对象:", withoutUntrack === withUntrack);

    // 两者都应该可以调用 getStyle
    expect(typeof withoutUntrack.getStyle).toBe("function");
    expect(typeof withUntrack.getStyle).toBe("function");
  });

  it("应该测试 JSX 渲染场景（模拟 MessageList）", async () => {
    const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
    const syntaxStyle = SyntaxStyle.fromTheme(rules);

    // 模拟 MessageList.tsx 中的状态
    const [getSyntaxStyle] = createSignal(syntaxStyle);

    // 模拟 validSyntaxStyle createMemo
    const validSyntaxStyle = createMemo(() => {
      const style = getSyntaxStyle();
      if (!style) return null;
      if (typeof style.getStyle !== "function") {
        console.warn("getStyle 不是函数!");
        return null;
      }
      return style;
    });

    // 模拟 JSX 渲染时的情况
    const style = validSyntaxStyle();

    if (style) {
      console.log("\n模拟 JSX 渲染:");
      console.log("  - style 类型:", typeof style);
      console.log("  - 是 SyntaxStyle 实例:", style instanceof SyntaxStyle);
      console.log("  - 有 getStyle 方法:", typeof style.getStyle === "function");

      // 这个测试检查当 SolidJS 将值传递给子组件时会发生什么
      // 在真实的 <markdown> 组件中，这个值会被进一步包装

      try {
        // 模拟 <markdown> 组件内部调用
        const result = style.getStyle("default");
        console.log("  - 调用 getStyle 结果:", result);
      } catch (e) {
        console.error("  - 调用 getStyle 失败:", (e as Error).message);
        throw e;
      }
    }
  });

  it("应该测试参数传递时的包装问题", () => {
    const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
    const [getSyntaxStyle] = createSignal(SyntaxStyle.fromTheme(rules));

    const validSyntaxStyle = createMemo(() => {
      const style = getSyntaxStyle();
      return style && typeof style.getStyle === "function" ? style : null;
    });

    // 模拟 MessageList.tsx 中的回调函数
    function renderMarkdown(style: any) {
      console.log("\nrenderMarkdown 接收到的参数:");
      console.log("  - 参数类型:", typeof style);
      console.log("  - 是 SyntaxStyle 实例:", style instanceof SyntaxStyle);
      console.log("  - 有 getStyle:", typeof style?.getStyle === "function");

      if (style && typeof style.getStyle === "function") {
        try {
          const result = style.getStyle("default");
          console.log("  - getStyle 调用成功:", result);
          return result;
        } catch (e) {
          console.error("  - getStyle 调用失败:", (e as Error).message);
          throw e;
        }
      }
      return null;
    }

    const style = validSyntaxStyle();
    if (style) {
      renderMarkdown(style);
    }
  });
});

describe("问题诊断", () => {
  it("应该分析 SyntaxStyle 实例的内部结构", () => {
    const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
    const syntaxStyle = SyntaxStyle.fromTheme(rules);

    console.log("\n========== SyntaxStyle 实例分析 ==========");
    console.log("实例类型:", typeof syntaxStyle);
    console.log("实例构造函数:", syntaxStyle.constructor.name);
    console.log("实例原型:", Object.getPrototypeOf(syntaxStyle)?.constructor?.name);

    const props = Object.getOwnPropertyNames(syntaxStyle);
    console.log("实例属性:", props);

    const descriptors = Object.getOwnPropertyDescriptors(syntaxStyle);
    console.log("\ngetStyle 描述符:", descriptors.getStyle);

    // 检查原型链
    let proto = Object.getPrototypeOf(syntaxStyle);
    while (proto) {
      console.log("\n原型:", proto.constructor?.name);
      const protoMethods = Object.getOwnPropertyNames(proto).filter(
        (name) => typeof proto[name] === "function"
      );
      console.log("  方法:", protoMethods);
      proto = Object.getPrototypeOf(proto);
    }
    console.log("==========================================\n");

    expect(syntaxStyle.constructor.name).toBe("SyntaxStyle");
  });

  it("应该对比原始对象和响应式对象", () => {
    const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
    const original = SyntaxStyle.fromTheme(rules);
    const [getSignal] = createSignal(original);

    const fromSignal = getSignal();

    console.log("\n========== 对象对比 ==========");
    console.log("原始对象 === Signal 返回值:", original === fromSignal);
    console.log("原始对象类型:", typeof original);
    console.log("Signal 返回值类型:", typeof fromSignal);
    console.log("原始 getStyle:", typeof original.getStyle);
    console.log("Signal getStyle:", typeof fromSignal.getStyle);

    // 检查属性描述符
    const originalDesc = Object.getOwnPropertyDescriptor(original, "getStyle");
    const signalDesc = Object.getOwnPropertyDescriptor(fromSignal, "getStyle");

    console.log("\n原始 getStyle 描述符:", originalDesc);
    console.log("Signal getStyle 描述符:", signalDesc);
    console.log("==============================\n");

    // 在 SolidJS 中，这两个应该是同一个对象
    expect(original).toBe(fromSignal);
  });
});
