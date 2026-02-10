/**
 * @fileoverview Markdown 组件更新场景测试
 * 
 * 复现 TUI 中组件更新时 SyntaxStyle 失效的问题
 * 
 * 运行方式：
 * bun run --conditions=browser --preload ./node_modules/@opentui/solid/scripts/preload.ts ./src/cli/tui/test/markdown-update-test.tsx
 */

import { SyntaxStyle, resolveRenderLib } from "@opentui/core";
import { createSignal, createMemo, Show, createEffect } from "solid-js";

console.log("\n========== Markdown 更新场景测试 ==========\n");

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

// 模拟 MessageList 的完整状态
const [getSyntaxStyle] = createSignal(syntaxStyle);
const [getContent, setContent] = createSignal("");
const [getIsStreaming, setIsStreaming] = createSignal(false);

let rawSyntaxStyleRef: SyntaxStyle | null = null;
let renderCount = 0;

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
const isStreaming = createMemo(() => getIsStreaming());

// 创建测试组件（完全模拟 MessageList.tsx）
function TestComponent() {
  renderCount++;
  const memoValue = validSyntaxStyle();
  const content = displayContent();
  const streaming = isStreaming();

  console.log(`\n--- 渲染 #${renderCount} ---`);
  console.log("  - validSyntaxStyle:", memoValue !== null ? "有效" : "null");
  console.log("  - rawSyntaxStyleRef:", rawSyntaxStyleRef !== null ? "有效" : "null");
  console.log("  - content:", content.substring(0, 30) + (content.length > 30 ? "..." : ""));
  console.log("  - streaming:", streaming);

  // 添加 effect 来监控变化
  createEffect(() => {
    const style = validSyntaxStyle();
    const currentContent = displayContent();
    console.log(`  [Effect] 内容变化: "${currentContent.substring(0, 20)}..."`);
    
    if (style) {
      try {
        style.getStyle("markup.strong");
      } catch (e) {
        console.error(`  [Effect] ✗ getStyle 失败:`, (e as Error).message);
      }
    }
  });

  if (!memoValue) {
    return (
      <box>
        <text>Fallback (no syntax style)</text>
      </box>
    );
  }

  return (
    <Show when={memoValue}>
      {(style: SyntaxStyle) => {
        console.log("  Show 回调执行");
        
        // 方案 1: 使用 rawSyntaxStyleRef
        const rawStyle = rawSyntaxStyleRef || style;
        
        console.log("    - style 类型:", typeof style);
        console.log("    - style 构造函数:", style?.constructor?.name);
        console.log("    - style.getStyle:", typeof style?.getStyle);
        console.log("    - rawStyle.getStyle:", typeof rawStyle?.getStyle);

        // 在传给 markdown 之前测试
        try {
          const test1 = style.getStyle("default");
          console.log("    - ✓ style.getStyle 可用");
        } catch (e) {
          console.error("    - ✗ style.getStyle 失败:", (e as Error).message);
        }

        try {
          const test2 = rawStyle.getStyle("default");
          console.log("    - ✓ rawStyle.getStyle 可用");
        } catch (e) {
          console.error("    - ✗ rawStyle.getStyle 失败:", (e as Error).message);
        }

        console.log("    - 准备渲染 <markdown>...");
        
        // 关键：这里可能出错
        try {
          return (
            <box flexDirection="column">
              <markdown
                content={content}
                syntaxStyle={rawStyle}
                streaming={streaming}
                conceal={false}
              />
              {streaming && <text>▊</text>}
            </box>
          );
        } catch (e) {
          console.error("    - ✗ <markdown> 渲染失败:", (e as Error).message);
          return (
            <box>
              <text fg="#ff0000">Render Error</text>
            </box>
          );
        }
      }}
    </Show>
  );
}

// 模拟真实场景：先 start streaming，然后接收 chunks
console.log("\n========== 场景：流式接收消息 ==========\n");

async function simulateStream() {
  // 场景 1: 开始流式传输
  console.log("\n>>> 场景 1: stream.start");
  setIsStreaming(true);
  setContent("");
  
  // 触发渲染
  TestComponent();
  
  // 场景 2: 接收第一个 chunk
  console.log("\n>>> 场景 2: 接收第一个 chunk");
  setContent("# 标题\n\n");
  TestComponent();
  
  // 场景 3: 接收更多 chunks（模拟 batch 更新）
  console.log("\n>>> 场景 3: 快速接收多个 chunks");
  const chunks = [
    "这是**加粗**文本。\n\n",
    "```typescript\n",
    "const x = 1;\n",
    "```"
  ];
  
  for (const chunk of chunks) {
    setContent(prev => prev + chunk);
    TestComponent();
    await new Promise(resolve => setTimeout(resolve, 10)); // 小延迟
  }
  
  // 场景 4: 完成流式传输
  console.log("\n>>> 场景 4: stream.completed");
  setIsStreaming(false);
  TestComponent();
  
  // 场景 5: 再次更新（模拟后续消息）
  console.log("\n>>> 场景 5: 新消息");
  setContent("新消息 **bold**");
  TestComponent();
  
  console.log("\n========== 测试结果 ==========");
  console.log("总渲染次数:", renderCount);
  console.log("如果没有看到错误，问题可能只在真实终端环境中出现");
  console.log("==============================\n");
}

simulateStream().catch(console.error);
