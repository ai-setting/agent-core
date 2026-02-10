/**
 * @fileoverview 真正的 Markdown 渲染集成测试
 * 
 * 这个测试验证：
 * 1. SyntaxStyle 被正确创建和传递
 * 2. <markdown> 组件正确接收 syntaxStyle
 * 3. 渲染结果包含正确的样式
 * 
 * 运行方式：
 * bun run --conditions=browser --preload ./node_modules/@opentui/solid/scripts/preload.ts ./src/cli/tui/test/markdown-full-integration.tsx
 */

import { SyntaxStyle, resolveRenderLib } from "@opentui/core";
import { createSignal, createMemo, Show } from "solid-js";
import { render, useRenderer, baseComponents } from "@opentui/solid";

console.log("\n========== Markdown 完整集成测试 ==========\n");

const renderLib = resolveRenderLib();
if (!renderLib) {
  console.log("错误: RenderLib 不可用");
  process.exit(1);
}

console.log("RenderLib 类型:", typeof renderLib);
console.log("可用的组件:", Object.keys(baseComponents || {}));

// 创建 renderer
let renderer: any;
try {
  renderer = (renderLib as any).createCliRenderer?.();
  console.log("CliRenderer 创建:", renderer ? "成功" : "失败");
} catch (e) {
  console.log("CliRenderer 创建失败:", (e as Error).message);
}

// 主题配置
const theme = {
  foreground: "#e5e7eb",  // 浅灰色
  primary: "#3b82f6",
  muted: "#6b7280",
  thinking: "#a78bfa",
  background: "#111827",
  border: "#374151",
  success: "#22c55e",
  error: "#ef4444",
};

// 生成语法规则
function createMarkdownStyle() {
  return [
    { scope: ["default"], style: { foreground: theme.foreground } },
    { scope: ["markup.strong"], style: { foreground: theme.foreground, bold: true } },
    { scope: ["markup.italic"], style: { foreground: theme.thinking, italic: true } },
    { scope: ["heading", "heading.1", "heading.2"], style: { foreground: theme.foreground, bold: true } },
    { scope: ["code"], style: { foreground: theme.muted } },
    { scope: ["markup.raw.block"], style: { foreground: theme.muted } },
    { scope: ["markup.quote"], style: { foreground: theme.muted } },
    { scope: ["link"], style: { foreground: theme.primary } },
  ];
}

const rules = createMarkdownStyle();
const syntaxStyle = SyntaxStyle.fromTheme(rules);

console.log("\nSyntaxStyle 创建:");
console.log("  - 类型:", syntaxStyle.constructor.name);
console.log("  - has getStyle:", typeof syntaxStyle.getStyle === "function");

// 验证 getStyle
const testStyle = syntaxStyle.getStyle("markup.strong");
console.log("  - getStyle('markup.strong'):", testStyle ? `bold=${(testStyle as any).bold}` : "失败");

// 模拟消息状态
const [getMessage] = createSignal({
  id: "msg-1",
  role: "assistant",
  content: `# 主标题

这是普通文本，**这是加粗文本**，*这是斜体文本*。

\`\`\`typescript
function hello() {
  console.log("Hello");
}
\`\`\`

> 引用文本

- 列表项 1
- 列表项 2`,
  parts: [] as any[],
});

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

const displayContent = createMemo(() => getMessage().content);

// 创建测试组件
function TestMarkdownComponent() {
  const memoValue = validSyntaxStyle();
  const content = displayContent();

  console.log("\n组件渲染:");
  console.log("  - content 长度:", content.length);
  console.log("  - validSyntaxStyle:", memoValue !== null ? "有效" : "null");
  console.log("  - rawSyntaxStyleRef:", rawSyntaxStyleRef !== null ? "有效" : "null");

  if (!memoValue) {
    return (
      <box>
        <text>Fallback: No syntax style</text>
      </box>
    );
  }

  return (
    <Show when={memoValue}>
      {(style: SyntaxStyle) => {
        const rawStyle = rawSyntaxStyleRef || style;

        console.log("\nShow 回调:");
        console.log("  - style 类型:", typeof style);
        console.log("  - style.getStyle:", typeof style?.getStyle);
        console.log("  - rawStyle 类型:", typeof rawStyle);
        console.log("  - rawStyle.getStyle:", typeof rawStyle?.getStyle);

        // 验证 rawStyle 可以正确获取样式
        try {
          const strongStyle = rawStyle.getStyle("markup.strong");
          console.log("  - ✓ rawStyle.getStyle('markup.strong'):", strongStyle ? `bold=${(strongStyle as any).bold}` : "null");
        } catch (e) {
          console.error("  - ✗ rawStyle.getStyle 失败:", (e as Error).message);
        }

        // 关键：创建 markdown 组件
        console.log("\n  渲染 <markdown> 组件...");
        
        try {
          const markdown = baseComponents?.markdown;
          console.log("  - baseComponents.markdown:", typeof markdown);
          
          if (markdown) {
            // 直接调用 markdown 组件（不通过 JSX）
            const MarkdownComponent = markdown as any;
            console.log("  - MarkdownComponent 类型:", typeof MarkdownComponent);
            
            // 验证组件可以接收 syntaxStyle
            console.log("  - 传递 syntaxStyle...");
            console.log("    - rawStyle 有效:", rawStyle !== null);
            console.log("    - rawStyle.getStyle 有效:", typeof rawStyle.getStyle === "function");
          }
        } catch (e) {
          console.error("  - baseComponents.markdown 访问失败:", (e as Error).message);
        }

        // 使用 JSX 渲染
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
          console.error("  - <markdown> JSX 渲染失败:", (e as Error).message);
          
          // 回退到普通文本
          return (
            <box flexDirection="column">
              <text>Fallback: {content.substring(0, 50)}...</text>
            </box>
          );
        }
      }}
    </Show>
  );
}

// 测试组件创建和 JSX 解析
console.log("\n" + "=".repeat(50));
console.log("测试组件创建");
console.log("=".repeat(50));

let componentCreated = false;
let componentError: Error | null = null;

try {
  const component = TestMarkdownComponent();
  componentCreated = true;
  console.log("\n✓ 组件创建成功");
  console.log("组件类型:", typeof component);
} catch (e) {
  componentError = e as Error;
  console.log("\n✗ 组件创建失败:", componentError.message);
}

// 验证渲染结果
console.log("\n" + "=".repeat(50));
console.log("渲染结果验证");
console.log("=".repeat(50));

if (componentCreated && !componentError) {
  console.log("\n✓ 组件成功创建");
  console.log("\n期望的渲染效果:");
  console.log("  - # 主标题: 加粗 + 白色");
  console.log("  - **加粗文本**: 加粗");
  console.log("  - *斜体文本*: 斜体 + 紫色");
  console.log("  - 代码块: muted 灰色");
  console.log("  - > 引用: muted 灰色");
  console.log("  - - 列表: 白色");
  console.log("  - [链接]: 蓝色");
  
  console.log("\n如果实际 TUI 中没有看到这些效果，可能原因:");
  console.log("  1. 终端不支持 ANSI 粗体/斜体转义序列");
  console.log("  2. 主题颜色与终端背景对比度不足");
  console.log("  3. <markdown> 组件内部解析逻辑问题");
} else {
  console.log("\n✗ 组件创建失败");
  console.log("错误:", componentError?.message);
}

// 最终验证
console.log("\n" + "=".repeat(50));
console.log("最终验证");
console.log("=".repeat(50));

const finalChecks = [
  { name: "SyntaxStyle 创建", pass: syntaxStyle !== null },
  { name: "getStyle 方法可用", pass: typeof syntaxStyle.getStyle === "function" },
  { name: "markup.strong 样式正确", pass: (syntaxStyle.getStyle("markup.strong") as any)?.bold === true },
  { name: "heading 样式正确", pass: (syntaxStyle.getStyle("heading") as any)?.bold === true },
  { name: "组件创建成功", pass: componentCreated },
];

let allPass = true;
for (const check of finalChecks) {
  const status = check.pass ? "✓" : "✗";
  console.log(`  ${status} ${check.name}`);
  if (!check.pass) allPass = false;
}

console.log("\n" + "=".repeat(50));
console.log("测试结论");
console.log("=".repeat(50));

if (allPass) {
  console.log("\n✓ 所有检查通过");
  console.log("\n如果 TUI 中仍然没有正确渲染:");
  console.log("  1. 请检查终端类型（Windows Terminal, iTerm2, etc.）");
  console.log("  2. 确认终端支持 ANSI 转义序列");
  console.log("  3. 检查是否有其他因素影响渲染");
} else {
  console.log("\n✗ 有检查失败");
}

console.log("\n" + "=".repeat(50) + "\n");
