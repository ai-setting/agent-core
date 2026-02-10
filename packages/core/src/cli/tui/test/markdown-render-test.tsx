/**
 * @fileoverview 直接在 TUI 中测试 Markdown 渲染
 * 
 * 运行方式：
 * bun run --conditions=browser --preload ./node_modules/@opentui/solid/scripts/preload.ts ./src/cli/tui/test/markdown-render-test.tsx
 */

import { SyntaxStyle, resolveRenderLib } from "@opentui/core";
import { createSignal, createMemo } from "solid-js";

console.log("\n========== Markdown 渲染测试 ==========\n");

// 检查环境
const renderLib = resolveRenderLib();
console.log("环境检查:");
console.log("  - RenderLib 可用:", renderLib !== null);
console.log("  - RenderLib 类型:", typeof renderLib);

if (!renderLib) {
  console.log("\n错误: RenderLib 不可用，无法测试");
  process.exit(1);
}

// 创建 SyntaxStyle
const rules = [
  { scope: ["default"], style: { foreground: "#ffffff" } },
  { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
  { scope: ["heading"], style: { foreground: "#ffffff", bold: true } },
];

const syntaxStyle = SyntaxStyle.fromTheme(rules);

console.log("\nSyntaxStyle 创建:");
console.log("  - 类型:", syntaxStyle.constructor.name);
console.log("  - has getStyle:", typeof syntaxStyle.getStyle === "function");

// 测试 getStyle
const defaultStyle = syntaxStyle.getStyle("default");
const strongStyle = syntaxStyle.getStyle("markup.strong");
console.log("  - default 样式:", defaultStyle ? "成功" : "失败");
console.log("  - strong 样式:", strongStyle ? "成功" : "失败");

// 模拟 MessageList.tsx 的逻辑
console.log("\n========== MessageList 逻辑测试 ==========\n");

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

console.log("createMemo 结果:");
console.log("  - memoValue:", memoValue !== null ? "有效" : "null");
console.log("  - rawSyntaxStyleRef:", rawSyntaxStyleRef !== null ? "有效" : "null");
console.log("  - memoValue === rawSyntaxStyleRef:", memoValue === rawSyntaxStyleRef);

// 测试直接访问
if (memoValue) {
  console.log("\n直接访问测试:");
  console.log("  - memoValue.getStyle:", typeof memoValue.getStyle);
  
  try {
    const result = memoValue.getStyle("default");
    console.log("  - ✓ 直接调用成功");
  } catch (e) {
    console.error("  - ✗ 直接调用失败:", (e as Error).message);
  }
}

// 测试流式更新场景
console.log("\n========== 流式更新场景测试 ==========\n");

const [getContent, setContent] = createSignal("");

const chunks = ["Hello ", "**World**", "!"];
let updateCount = 0;
let hasError = false;

for (const chunk of chunks) {
  updateCount++;
  setContent(prev => prev + chunk);
  
  const style = validSyntaxStyle();
  const content = getContent();
  
  console.log(`更新 #${updateCount}: "${content}"`);
  
  if (style) {
    try {
      style.getStyle("markup.strong");
      console.log("  - ✓ getStyle 可用");
    } catch (e) {
      console.error("  - ✗ getStyle 失败:", (e as Error).message);
      hasError = true;
    }
  }
}

console.log("\n========== 测试结果 ==========\n");

if (hasError) {
  console.log("✗ 测试失败：发现 SyntaxStyle 方法丢失问题");
  process.exit(1);
} else {
  console.log("✓ 测试通过：在当前环境中 getStyle 方法可用");
  console.log("\n说明：");
  console.log("  - 当前环境可能无法完全复现 TUI 运行时的问题");
  console.log("  - 问题可能只在实际渲染 <markdown> 组件时出现");
  console.log("  - 需要在实际 TUI 消息渲染时观察问题");
}

console.log("\n==============================\n");
