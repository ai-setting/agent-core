/**
 * @fileoverview Markdown 语法渲染效果验证测试
 * 
 * 验证：
 * 1. SyntaxStyle 规则配置是否正确
 * 2. getStyle 返回的样式是否包含期望的属性
 * 3. **加粗** 和 ### 标题 是否能正确解析
 * 
 * 运行方式：
 * bun run --conditions=browser --preload ./node_modules/@opentui/solid/scripts/preload.ts ./src/cli/tui/test/markdown-syntax-verify.tsx
 */

import { SyntaxStyle, resolveRenderLib } from "@opentui/core";
import { generateMarkdownSyntax } from "../lib/markdown-syntax.js";

console.log("\n========== Markdown 语法渲染验证 ==========\n");

const renderLib = resolveRenderLib();
if (!renderLib) {
  console.log("错误: RenderLib 不可用");
  process.exit(1);
}

// 模拟主题配置
const theme = {
  foreground: "#ffffff",
  primary: "#3b82f6",      // 蓝色
  muted: "#6b7280",        // 灰色
  thinking: "#a78bfa",     // 紫色
  background: "#1f2937",
  border: "#374151",
  success: "#22c55e",
  error: "#ef4444",
};

// 生成语法规则
const rules = generateMarkdownSyntax(theme);

console.log("生成的语法规则数量:", rules.length);
console.log("\n规则详情:");

for (const rule of rules) {
  console.log(`\n  scope: ${JSON.stringify(rule.scope)}`);
  console.log(`  style: ${JSON.stringify(rule.style)}`);
}

// 创建 SyntaxStyle
const syntaxStyle = SyntaxStyle.fromTheme(rules);

console.log("\n" + "=".repeat(50));
console.log("验证 getStyle 返回的样式");
console.log("=".repeat(50) + "\n");

// 测试各种 markdown 元素的样式解析
const testCases = [
  { scope: "default", description: "默认文本" },
  { scope: "markup.strong", description: "**加粗**" },
  { scope: "markup.italic", description: "*斜体*" },
  { scope: "markup.raw", description: "`行内代码`" },
  { scope: "heading", description: "# 标题" },
  { scope: "heading.1", description: "# 一级标题" },
  { scope: "heading.2", description: "## 二级标题" },
  { scope: "code", description: "```代码块```" },
  { scope: "markup.quote", description: "> 引用" },
  { scope: "link", description: "[链接](url)" },
];

let successCount = 0;
let failCount = 0;

for (const testCase of testCases) {
  try {
    const style = syntaxStyle.getStyle(testCase.scope);
    
    console.log(`${testCase.description} (${testCase.scope}):`);
    if (style) {
      console.log(`  ✓ 成功获取样式: ${JSON.stringify(style)}`);
      
      // 验证期望的属性
      const expectedProps: Record<string, boolean> = {};
      if (testCase.scope === "markup.strong") {
        expectedProps.bold = true;
      }
      if (testCase.scope === "markup.italic") {
        expectedProps.italic = true;
      }
      if (testCase.scope?.includes("heading")) {
        expectedProps.bold = true;
      }
      
      // 检查期望的属性
      for (const [prop, shouldBe] of Object.entries(expectedProps)) {
        if ((style as any)[prop] === shouldBe) {
          console.log(`  ✓ ${prop} 属性正确: ${shouldBe}`);
        } else {
          console.log(`  ⚠ ${prop} 属性: ${(style as any)[prop]} (期望: ${shouldBe})`);
        }
      }
      
      successCount++;
    } else {
      console.log(`  ✗ 未获取到样式`);
      failCount++;
    }
  } catch (e) {
    console.log(`  ✗ 获取样式失败: ${(e as Error).message}`);
    failCount++;
  }
}

console.log("\n" + "=".repeat(50));
console.log("测试结果汇总");
console.log("=".repeat(50));
console.log(`  成功: ${successCount}/${testCases.length}`);
console.log(`  失败: ${failCount}/${testCases.length}`);

// 模拟 markdown 渲染
console.log("\n" + "=".repeat(50));
console.log("模拟 Markdown 渲染");
console.log("=".repeat(50) + "\n");

const testMarkdown = `# 主标题

这是普通文本，**这是加粗文本**，*这是斜体文本*。

\`\`\`typescript
function hello() {
  console.log("Hello World");
}
\`\`\`

> 这是一段引用

- 列表项 1
- 列表项 2

[链接文本](https://example.com)`;

console.log("输入 Markdown:");
console.log(testMarkdown);
console.log("\n期望渲染效果:");
console.log("  - 主标题: 加粗显示");
console.log("  - **加粗文本**: 加粗显示");
console.log("  - *斜体文本*: 斜体显示");
console.log("  - 代码块: muted 颜色显示");
console.log("  - 引用: muted 颜色显示");
console.log("  - 列表: 默认前景色");
console.log("  - 链接: primary 颜色显示");

// 验证语法规则是否支持这些元素
console.log("\n语法规则支持检查:");

const requiredScopes = [
  { scope: "heading", neededFor: "# 标题", present: false },
  { scope: "markup.strong", neededFor: "**加粗**", present: false },
  { scope: "markup.italic", neededFor: "*斜体*", present: false },
  { scope: "code", neededFor: "行内代码", present: false },
  { scope: "markup.raw.block", neededFor: "代码块", present: false },
  { scope: "markup.quote", neededFor: "> 引用", present: false },
  { scope: "markup.list", neededFor: "- 列表", present: false },
  { scope: "link", neededFor: "[链接](url)", present: false },
];

for (const rule of rules) {
  for (const required of requiredScopes) {
    if (rule.scope.includes(required.scope)) {
      required.present = true;
    }
  }
}

for (const required of requiredScopes) {
  const status = required.present ? "✓" : "✗";
  console.log(`  ${status} ${required.scope}: ${required.neededFor}`);
}

// 总结
console.log("\n" + "=".repeat(50));
console.log("测试结论");
console.log("=".repeat(50));

if (failCount === 0) {
  console.log("✓ 所有语法规则都能正确解析");
  console.log("\n如果 TUI 中仍然没有正确渲染，可能原因:");
  console.log("  1. <markdown> 组件没有正确使用 syntaxStyle");
  console.log("  2. 终端不支持某些渲染属性（如 bold）");
  console.log("  3. 样式被其他 CSS/主题覆盖");
} else {
  console.log(`✗ 有 ${failCount} 个规则解析失败`);
}

console.log("\n建议:");
console.log("  1. 在 TUI 中查看 <markdown> 组件接收到的 syntaxStyle");
console.log("  2. 确认 renderLib 是否正确创建");
console.log("  3. 检查终端类型和属性支持");
console.log("\n" + "=".repeat(50) + "\n");
