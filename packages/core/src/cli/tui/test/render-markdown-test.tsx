/**
 * @fileoverview 实际渲染 <markdown> 组件测试
 * 
 * 运行方式：
 * bun run --conditions=browser --preload ./node_modules/@opentui/solid/scripts/preload.ts ./src/cli/tui/test/render-markdown-test.tsx
 */

import { SyntaxStyle, resolveRenderLib, CliRenderer } from "@opentui/core";
import { createSignal, createMemo, Show } from "solid-js";
import { render } from "@opentui/solid";

console.log("\n========== Markdown 组件渲染测试 ==========\n");

const renderLib = resolveRenderLib();
if (!renderLib) {
  console.log("错误: RenderLib 不可用");
  process.exit(1);
}

// 创建 SyntaxStyle
const rules = [
  { scope: ["default"], style: { foreground: "#ffffff" } },
  { scope: ["markup.strong"], style: { foreground: "#ffffff", bold: true } },
  { scope: ["heading"], style: { foreground: "#ffffff", bold: true } },
  { scope: ["code"], style: { foreground: "#888888" } },
];

const syntaxStyle = SyntaxStyle.fromTheme(rules);

console.log("SyntaxStyle:");
console.log("  - 创建成功:", syntaxStyle.constructor.name);
console.log("  - getStyle 可用:", typeof syntaxStyle.getStyle === "function");

// 模拟 MessageList.tsx 的完整逻辑
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

// 创建测试组件（完全模拟 MessageList.tsx 的结构）
function TestComponent() {
  const memoValue = validSyntaxStyle();

  console.log("\nTestComponent 渲染:");
  console.log("  - validSyntaxStyle():", memoValue !== null ? "有效" : "null");
  console.log("  - rawSyntaxStyleRef:", rawSyntaxStyleRef !== null ? "有效" : "null");

  if (!memoValue) {
    return (
      <box>
        <text>No syntax style</text>
      </box>
    );
  }

  return (
    <Show when={memoValue}>
      {(style: SyntaxStyle) => {
        // 这就是 MessageList.tsx 第 113-144 行
        const rawStyle = rawSyntaxStyleRef || style;

        console.log("\nShow 回调执行:");
        console.log("  - style 类型:", typeof style);
        console.log("  - style 构造函数:", style?.constructor?.name);
        console.log("  - style has getStyle:", typeof style?.getStyle === "function");
        console.log("  - rawStyle === style:", rawStyle === style);
        console.log("  - rawStyle has getStyle:", typeof rawStyle?.getStyle === "function");

        // 尝试在传给 markdown 之前调用 getStyle
        try {
          const testResult = style.getStyle("default");
          console.log("  - ✓ 回调内 getStyle 测试成功");
        } catch (e) {
          console.error("  - ✗ 回调内 getStyle 测试失败:", (e as Error).message);
        }

        const content = displayContent();
        
        console.log("  - 渲染内容:", content.substring(0, 50));
        console.log("  - 尝试渲染 <markdown> 组件...");

        // 关键：这里可能触发错误！
        try {
          return (
            <box flexDirection="column">
              <markdown
                content={content}
                syntaxStyle={rawStyle}
                streaming={false}
                conceal={false}
              />
            </box>
          );
        } catch (e) {
          console.error("  - ✗ 渲染 <markdown> 失败:", (e as Error).message);
          return (
            <box>
              <text fg="#ff0000">Error: {(e as Error).message}</text>
            </box>
          );
        }
      }}
    </Show>
  );
}

// 模拟流式内容更新
console.log("\n========== 模拟流式更新 ==========\n");

const chunks = [
  "# 标题\n\n",
  "这是**加粗**文本。\n\n",
  "```typescript\nconst x = 1;\n```"
];

async function runTest() {
  console.log("设置初始内容...");
  setContent("# 测试\n\n**Hello**");

  console.log("\n尝试渲染组件...");
  
  try {
    // 注意：我们无法真正渲染到终端（需要完整的 TUI 环境）
    // 但组件创建过程本身就会执行一些逻辑
    const component = TestComponent;
    console.log("组件创建成功");
    
    // 如果有 CliRenderer，可以尝试渲染
    // const renderer = (renderLib as any).createCliRenderer?.();
    // if (renderer) {
    //   render(() => component(), renderer);
    // }
    
  } catch (e) {
    console.error("组件创建/渲染失败:", (e as Error).message);
    console.error((e as Error).stack);
  }

  console.log("\n========== 流式更新测试 ==========\n");

  for (let i = 0; i < chunks.length; i++) {
    console.log(`更新 #${i + 1}...`);
    setContent(prev => prev + chunks[i]);
    
    // 模拟重新渲染
    const style = validSyntaxStyle();
    if (style) {
      try {
        style.getStyle("markup.strong");
        console.log("  - ✓ getStyle 可用");
      } catch (e) {
        console.error("  - ✗ getStyle 失败:", (e as Error).message);
      }
    }
  }

  console.log("\n========== 测试完成 ==========\n");
  console.log("如果上述过程没有出现错误，但 TUI 中仍然有问题，");
  console.log("说明问题可能出现在:");
  console.log("  1. 真实的终端渲染环境");
  console.log("  2. 与 stream.text 事件交互时");
  console.log("  3. 特定的时序或并发场景");
  console.log("\n==============================\n");
}

runTest().catch(console.error);
