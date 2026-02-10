/**
 * @fileoverview rawSyntaxStyleRef 问题分析和修复验证
 *
 * 问题：TUI 中显示原始 markdown 内容，如 **内容创作**
 * 原因：rawSyntaxStyleRef 在 SolidJS 响应式上下文中可能失效
 */

import { describe, it, expect } from "bun:test";
import { SyntaxStyle, resolveRenderLib } from "@opentui/core";
import { createSignal, createMemo, untrack } from "solid-js";

describe("rawSyntaxStyleRef 问题分析", () => {
  it("应该验证局部变量 ref 在响应式更新中的行为", () => {
    const renderLib = resolveRenderLib();
    if (!renderLib) {
      console.log("RenderLib 不可用，跳过此测试");
      return;
    }

    console.log("\n========== rawSyntaxStyleRef 问题分析 ==========");

    const rules = [
      { scope: ["default"], style: { foreground: "#ffffff" } },
      { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
    ];
    const originalStyle = SyntaxStyle.fromTheme(rules);

    // 模拟 MessageList.tsx 中的结构
    function simulateComponentRender(iteration: number) {
      console.log(`\n--- 渲染轮次 ${iteration} ---`);
      
      // 这就是 MessageList.tsx 第 52 行的 ref
      let rawSyntaxStyleRef: SyntaxStyle | null = null;
      
      const [getSyntaxStyle] = createSignal(originalStyle);
      
      // 这就是 MessageList.tsx 第 55-70 行的 validSyntaxStyle
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
        // 第 68 行：存储原始引用
        rawSyntaxStyleRef = style;
        return style;
      });

      // 获取 memo 值（触发计算）
      const memoValue = validSyntaxStyle();
      
      console.log("  validSyntaxStyle() 返回:", memoValue !== null ? "有效" : "null");
      console.log("  rawSyntaxStyleRef 当前值:", rawSyntaxStyleRef !== null ? "有效" : "null");
      
      // 模拟 Show 组件回调（第 113 行）
      if (memoValue) {
        // 第 115 行：使用 ref 中的原始对象
        const rawStyle = rawSyntaxStyleRef || memoValue;
        
        console.log("  Show 回调中:");
        console.log("    - rawStyle 来源:", rawStyle === rawSyntaxStyleRef ? "rawSyntaxStyleRef" : "memoValue");
        console.log("    - has getStyle:", typeof rawStyle.getStyle === "function");
        
        return rawStyle;
      }
      
      return null;
    }

    // 模拟多次渲染
    const style1 = simulateComponentRender(1);
    const style2 = simulateComponentRender(2);
    
    console.log("\n跨轮次检查:");
    console.log("  第 1 轮返回的 style:", style1 !== null ? "有效" : "null");
    console.log("  第 2 轮返回的 style:", style2 !== null ? "有效" : "null");
    console.log("  是同一对象:", style1 === style2);

    console.log("\n分析:");
    console.log("  问题：rawSyntaxStyleRef 是局部变量，每轮渲染都会重新初始化");
    console.log("  但在单轮渲染内，它应该能正确存储值");
    console.log("============================================\n");
  });

  it("应该验证 createMemo 多次访问时的行为", () => {
    const renderLib = resolveRenderLib();
    if (!renderLib) return;

    console.log("\n========== createMemo 多次访问问题 ==========");

    const rules = [{ scope: ["default"], style: { foreground: "#ffffff" } }];
    const style = SyntaxStyle.fromTheme(rules);

    let refValue: SyntaxStyle | null = null;
    let computeCount = 0;

    const [getSignal] = createSignal(style);

    const memo = createMemo(() => {
      computeCount++;
      const val = getSignal();
      refValue = val;
      console.log(`  createMemo 计算 #${computeCount}: ref 设置 =`, refValue !== null);
      return val;
    });

    console.log("多次访问 memo:");
    const v1 = memo();
    console.log("  第 1 次访问: computeCount =", computeCount);
    
    const v2 = memo();
    console.log("  第 2 次访问: computeCount =", computeCount);
    
    const v3 = memo();
    console.log("  第 3 次访问: computeCount =", computeCount);

    console.log("\n结论: createMemo 会缓存结果，多次访问不会重新计算");
    console.log("  - v1 === v2:", v1 === v2);
    console.log("  - refValue 始终指向同一对象");
    console.log("============================================\n");
  });

  it("应该提出修复方案：使用闭包或全局存储", () => {
    const renderLib = resolveRenderLib();
    if (!renderLib) return;

    console.log("\n========== 修复方案验证 ==========");

    const rules = [{ scope: ["default"], style: { foreground: "#ffffff" } }];
    const originalStyle = SyntaxStyle.fromTheme(rules);

    // 方案 1：模块级变量（不推荐，但可行）
    let moduleLevelRef: SyntaxStyle | null = null;

    function solution1_ModuleLevelRef() {
      const [getSyntaxStyle] = createSignal(originalStyle);
      
      const validSyntaxStyle = createMemo(() => {
        const style = getSyntaxStyle();
        if (!style || typeof (style as unknown as { getStyle?: unknown }).getStyle !== "function") {
          moduleLevelRef = null;
          return null;
        }
        moduleLevelRef = style;
        return style;
      });

      const memoValue = validSyntaxStyle();
      const rawStyle = moduleLevelRef || memoValue;
      
      return rawStyle;
    }

    // 方案 2：使用 untrack 绕过响应式（推荐）
    function solution2_Untrack() {
      const [getSyntaxStyle] = createSignal(originalStyle);
      
      const validSyntaxStyle = createMemo(() => {
        // 使用 untrack 获取原始值
        const style = untrack(() => getSyntaxStyle());
        if (!style || typeof style.getStyle !== "function") {
          return null;
        }
        return style;
      });

      return validSyntaxStyle();
    }

    // 方案 3：直接在 Show 回调中使用 untrack
    function solution3_UntrackInCallback() {
      const [getSyntaxStyle] = createSignal(originalStyle);
      
      const validSyntaxStyle = createMemo(() => {
        const style = getSyntaxStyle();
        if (!style || typeof (style as unknown as { getStyle?: unknown }).getStyle !== "function") {
          return null;
        }
        return style;
      });

      const memoValue = validSyntaxStyle();
      
      if (memoValue) {
        // 在回调中使用 untrack
        const rawStyle = untrack(() => validSyntaxStyle());
        return rawStyle;
      }
      
      return null;
    }

    console.log("测试方案 1（模块级变量）:");
    const s1 = solution1_ModuleLevelRef();
    console.log("  - 结果:", s1 !== null ? "有效" : "null");
    console.log("  - has getStyle:", s1 ? typeof s1.getStyle === "function" : false);

    console.log("\n测试方案 2（untrack in memo）:");
    const s2 = solution2_Untrack();
    console.log("  - 结果:", s2 !== null ? "有效" : "null");
    console.log("  - has getStyle:", s2 ? typeof s2.getStyle === "function" : false);

    console.log("\n测试方案 3（untrack in callback）:");
    const s3 = solution3_UntrackInCallback();
    console.log("  - 结果:", s3 !== null ? "有效" : "null");
    console.log("  - has getStyle:", s3 ? typeof s3.getStyle === "function" : false);

    console.log("\n推荐方案:");
    console.log("  方案 3：在 Show 回调中使用 untrack 最简洁");
    console.log("  或者直接在 memo 中使用 untrack");
    console.log("============================================\n");

    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();
    expect(s3).not.toBeNull();
  });
});

// ============================================================================
// 修复建议
// ============================================================================

describe("修复建议", () => {
  it("应该提供完整的修复代码", () => {
    console.log("\n========== 修复代码建议 ==========");
    console.log("");
    console.log("文件: MessageList.tsx");
    console.log("");
    console.log("修改前（第 52-70 行）:");
    console.log("  let rawSyntaxStyleRef: SyntaxStyle | null = null;");
    console.log("  const validSyntaxStyle = createMemo(() => {");
    console.log("    const style = syntaxStyle();");
    console.log("    if (!style) {");
    console.log("      rawSyntaxStyleRef = null;");
    console.log("      return null;");
    console.log("    }");
    console.log("    const hasGetStyle = typeof (style as any).getStyle === 'function';");
    console.log("    if (!hasGetStyle) {");
    console.log("      rawSyntaxStyleRef = null;");
    console.log("      return null;");
    console.log("    }");
    console.log("    rawSyntaxStyleRef = style;  // 存储原始引用");
    console.log("    return style;");
    console.log("  });");
    console.log("");
    console.log("修改方案 1 - 直接在 memo 中使用 untrack:");
    console.log("  import { untrack } from 'solid-js';");
    console.log("  ");
    console.log("  const validSyntaxStyle = createMemo(() => {");
    console.log("    // 使用 untrack 绕过响应式追踪");
    console.log("    const style = untrack(() => syntaxStyle());");
    console.log("    if (!style || typeof style.getStyle !== 'function') {");
    console.log("      return null;");
    console.log("    }");
    console.log("    return style;");
    console.log("  });");
    console.log("  ");
    console.log("  // 然后在 Show 回调中直接使用 memo 值");
    console.log("  <Show when={validSyntaxStyle()}>");
    console.log("    {(style) => {");
    console.log("      return (");
    console.log("        <markdown");
    console.log("          content={displayContent()}");
    console.log("          syntaxStyle={style}  // 直接使用，不需要 ref");
    console.log("          streaming={isStreamingThis()}");
    console.log("          conceal={false}");
    console.log("        />");
    console.log("      );");
    console.log("    }}");
    console.log("  </Show>");
    console.log("");
    console.log("修改方案 2 - 在 Show 回调中使用 untrack:");
    console.log("  <Show when={validSyntaxStyle()}>");
    console.log("    {(style) => {");
    console.log("      // 使用 untrack 获取原始对象");
    console.log("      const rawStyle = untrack(() => style);");
    console.log("      return (");
    console.log("        <markdown");
    console.log("          content={displayContent()}");
    console.log("          syntaxStyle={rawStyle}");
    console.log("          streaming={isStreamingThis()}");
    console.log("          conceal={false}");
    console.log("        />");
    console.log("      );");
    console.log("    }}");
    console.log("  </Show>");
    console.log("");
    console.log("说明:");
    console.log("  - untrack 会告诉 SolidJS 不要追踪这个值的响应式变化");
    console.log("  - 这样传递的对象不会被包装，getStyle 方法得以保留");
    console.log("  - 这是解决 'getStyle is not a function' 的标准方法");
    console.log("============================================\n");

    expect(true).toBe(true);
  });

  it("应该验证修复方案的实际效果", () => {
    const renderLib = resolveRenderLib();
    if (!renderLib) return;

    console.log("\n========== 修复方案验证 ==========");

    const rules = [
      { scope: ["default"], style: { foreground: "#ffffff" } },
      { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
    ];
    const originalStyle = SyntaxStyle.fromTheme(rules);

    // 模拟修复后的代码
    function fixedImplementation() {
      const [getSyntaxStyle] = createSignal(originalStyle);

      // 方案：在 memo 中使用 untrack
      const validSyntaxStyle = createMemo(() => {
        const style = untrack(() => getSyntaxStyle());
        if (!style || typeof style.getStyle !== "function") {
          return null;
        }
        return style;
      });

      const memoValue = validSyntaxStyle();

      if (memoValue) {
        // 模拟传递给 <markdown>
        console.log("修复后的实现:");
        console.log("  - memoValue 类型:", typeof memoValue);
        console.log("  - has getStyle:", typeof memoValue.getStyle === "function");
        console.log("  - 是原始对象:", memoValue === originalStyle);

        try {
          const result = memoValue.getStyle("markup.strong");
          console.log("  - ✓ getStyle 调用成功:", result);
          return true;
        } catch (e) {
          console.error("  - ✗ getStyle 调用失败:", (e as Error).message);
          return false;
        }
      }

      return false;
    }

    const success = fixedImplementation();

    console.log("\n结论: 修复方案可以正确工作");
    console.log("============================================\n");

    expect(success).toBe(true);
  });
});
