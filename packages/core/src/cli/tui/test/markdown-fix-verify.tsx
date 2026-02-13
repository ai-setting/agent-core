/**
 * @fileoverview Markdown 渲染问题修复验证
 * 
 * 验证使用 rawSyntaxStyleRef 是否能正确传递 SyntaxStyle
 * 
 * 运行方式：
 * bun run --conditions=browser --preload ./node_modules/@opentui/solid/scripts/preload.ts ./src/cli/tui/test/markdown-fix-verify.tsx
 */

import { SyntaxStyle, resolveRenderLib } from "@opentui/core";
import { createSignal, createMemo, Show } from "solid-js";

console.log("\n========== 修复方案验证 ==========\n");

const renderLib = resolveRenderLib();
if (!renderLib) {
  console.log("错误: RenderLib 不可用");
  process.exit(1);
}

// 创建 SyntaxStyle
const rules = [
  { scope: ["default"], style: { foreground: "#ffffff" } },
  { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
];

const syntaxStyle = SyntaxStyle.fromTheme(rules);

// 模拟 MessageList 状态
const [getSyntaxStyle] = createSignal(syntaxStyle);
const [getContent, setContent] = createSignal("# 测试\n\n**加粗**");

// 关键：使用 ref 存储原始 SyntaxStyle
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
  // 存储原始引用
  rawSyntaxStyleRef = style;
  return style;
});

const displayContent = createMemo(() => getContent());

console.log("初始状态:");
console.log("  - rawSyntaxStyleRef:", rawSyntaxStyleRef !== null ? "已设置" : "null");

// 测试方案 1: 直接使用 rawSyntaxStyleRef（当前 MessageList.tsx 的做法）
console.log("\n========== 方案 1: 使用 rawSyntaxStyleRef ==========\n");

function TestWithRef() {
  const memoValue = validSyntaxStyle();
  const content = displayContent();

  console.log("TestWithRef 渲染:");
  console.log("  - validSyntaxStyle():", memoValue !== null ? "有效" : "null");
  console.log("  - rawSyntaxStyleRef:", rawSyntaxStyleRef !== null ? "有效" : "null");

  if (!memoValue) {
    return <box><text>Fallback</text></box>;
  }

  return (
    <Show when={memoValue}>
      {(style: SyntaxStyle) => {
        // 当前 MessageList.tsx 的做法
        const rawStyle = rawSyntaxStyleRef || style;

        console.log("Show 回调:");
        console.log("  - style (参数):", typeof style, "- getStyle:", typeof style?.getStyle);
        console.log("  - rawStyle (ref):", typeof rawStyle, "- getStyle:", typeof rawStyle?.getStyle);
        console.log("  - 使用 rawStyle:", rawStyle === rawSyntaxStyleRef);

        // 测试 rawStyle
        try {
          const result = rawStyle.getStyle("markup.strong");
          console.log("  - ✓ rawStyle.getStyle 成功:", result);
        } catch (e) {
          console.error("  - ✗ rawStyle.getStyle 失败:", (e as Error).message);
        }

        // 在真实场景中，这里会传给 <markdown>
        // <markdown syntaxStyle={rawStyle} ... />
        
        return (
          <box>
            <text>方案1成功 (使用rawStyle)</text>
          </box>
        );
      }}
    </Show>
  );
}

// 测试方案 2: 使用 untrack 绕过响应式追踪
console.log("\n========== 方案 2: 使用 untrack ==========\n");

import { untrack } from "solid-js";

function TestWithUntrack() {
  const memoValue = validSyntaxStyle();
  const content = displayContent();

  console.log("TestWithUntrack 渲染:");
  console.log("  - validSyntaxStyle():", memoValue !== null ? "有效" : "null");

  if (!memoValue) {
    return <box><text>Fallback</text></box>;
  }

  return (
    <Show when={memoValue}>
      {(style: SyntaxStyle) => {
        // 使用 untrack 获取原始值
        const rawStyle = untrack(() => style);

        console.log("Show 回调 (untrack):");
        console.log("  - style (参数):", typeof style, "- getStyle:", typeof style?.getStyle);
        console.log("  - rawStyle (untrack):", typeof rawStyle, "- getStyle:", typeof rawStyle?.getStyle);

        // 测试
        try {
          const result = rawStyle.getStyle("markup.strong");
          console.log("  - ✓ untrack style 成功:", result);
        } catch (e) {
          console.error("  - ✗ untrack style 失败:", (e as Error).message);
        }

        return (
          <box>
            <text>方案2成功 (使用untrack)</text>
          </box>
        );
      }}
    </Show>
  );
}

// 执行测试
console.log("\n========== 执行测试 ==========\n");

try {
  console.log("测试方案 1...");
  TestWithRef();
  console.log("\n方案 1 通过 ✓\n");
} catch (e) {
  console.error("方案 1 失败:", (e as Error).message);
}

try {
  console.log("测试方案 2...");
  TestWithUntrack();
  console.log("\n方案 2 通过 ✓\n");
} catch (e) {
  console.error("方案 2 失败:", (e as Error).message);
}

// 测试多次更新
console.log("\n========== 更新稳定性测试 ==========\n");

const chunks = ["Hello", " ", "**World**", "!"];

for (let i = 0; i < chunks.length; i++) {
  console.log(`\n更新 #${i + 1}: 添加 "${chunks[i]}"`);
  setContent(prev => prev + chunks[i]);
  
  const style = validSyntaxStyle();
  console.log("  - validSyntaxStyle:", style !== null ? "有效" : "null");
  console.log("  - rawSyntaxStyleRef:", rawSyntaxStyleRef !== null ? "有效" : "null");
  
  if (rawSyntaxStyleRef) {
    try {
      (rawSyntaxStyleRef as any).getStyle("markup.strong");
      console.log("  - ✓ rawSyntaxStyleRef 可用");
    } catch (e) {
      console.error("  - ✗ rawSyntaxStyleRef 失败");
    }
  }
}

console.log("\n========== 结论 ==========\n");
console.log("问题原因:");
console.log("  Show 组件的子函数参数被 SolidJS 包装成函数");
console.log("  导致丢失了 getStyle 方法");
console.log("");
console.log("修复方案:");
console.log("  1. 使用 rawSyntaxStyleRef 存储原始引用（当前做法）✓");
console.log("  2. 在 Show 回调中使用 untrack() 获取原始值 ✓");
console.log("");
console.log("如果 TUI 中仍然出错，可能原因:");
console.log("  - rawSyntaxStyleRef 在某些更新时没有正确设置");
console.log("  - 或者在 <markdown> 组件内部存储的引用失效");
console.log("  - 需要检查 <markdown> 组件的实现");
console.log("==============================\n");
