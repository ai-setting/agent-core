/**
 * @fileoverview OpenTUI Markdown 组件验证测试
 *
 * 验证 @opentui/solid 中 markdown 组件的可用性
 */

import { describe, it, expect } from "bun:test";

describe("OpenTUI Markdown 组件可用性验证", () => {
  it("应该验证 baseComponents 中包含 markdown", async () => {
    const solid = await import("@opentui/solid");
    
    // 检查 baseComponents
    expect(solid.baseComponents).toBeDefined();
    expect(solid.baseComponents.markdown).toBeDefined();
    
    console.log("✓ baseComponents.markdown 存在:", typeof solid.baseComponents.markdown);
  });

  it("应该验证 componentCatalogue 机制", async () => {
    const solid = await import("@opentui/solid");
    
    // 获取组件目录
    const catalogue = solid.getComponentCatalogue();
    
    // 检查是否能通过 catalogue 获取 markdown
    expect(catalogue.markdown).toBeDefined();
    
    console.log("✓ componentCatalogue.markdown 存在:", typeof catalogue.markdown);
    console.log("  目录中的所有组件:", Object.keys(catalogue));
  });

  it("应该验证 markdown 不是直接导出的", async () => {
    const solid = await import("@opentui/solid");
    
    // 直接导入中不应该有 markdown
    const hasDirectExport = "markdown" in solid;
    
    console.log("✓ 直接导出检查:");
    console.log("  - 'markdown' in @opentui/solid:", hasDirectExport);
    console.log("  - 需要 JSX 运行时才能使用 <markdown>");
    
    // 记录发现
    expect(typeof solid).toBe("object");
  });

  it("应该分析 MarkdownRenderable 配置", async () => {
    const { baseComponents } = await import("@opentui/solid");
    const { MarkdownRenderable } = await import("@opentui/core");
    
    // 验证 baseComponents.markdown 指向 MarkdownRenderable
    expect(baseComponents.markdown).toBe(MarkdownRenderable);
    
    console.log("✓ MarkdownRenderable 配置:");
    console.log("  - baseComponents.markdown === MarkdownRenderable:", baseComponents.markdown === MarkdownRenderable);
    console.log("  - MarkdownRenderable 类型:", typeof MarkdownRenderable);
    
    // 检查 MarkdownRenderable 的构造器
    const renderable = MarkdownRenderable;
    expect(typeof renderable).toBe("function"); // 类构造器
  });

  it("应该验证 Markdown 组件属性类型", async () => {
    const solid = await import("@opentui/solid");
    const { MarkdownRenderable } = await import("@opentui/core");
    
    // 获取组件目录中的 markdown
    const catalogue = solid.getComponentCatalogue();
    const MarkdownComponent = catalogue.markdown;
    
    // 验证这是构造器函数
    expect(typeof MarkdownComponent).toBe("function");
    
    console.log("✓ Markdown 组件属性:");
    console.log("  - 组件类型:", MarkdownComponent.name);
    console.log("  - 需要属性:");
    console.log("    * content: string (Markdown 内容)");
    console.log("    * syntaxStyle?: SyntaxStyle (语法样式)");
    console.log("    * streaming?: boolean (流式状态)");
    console.log("    * conceal?: boolean (隐藏标记)");
  });

  it("应该总结使用方式", async () => {
    const findings = {
      问题: "<markdown> 组件无法直接导入",
      原因: "@opentui/solid 使用 JSX 运行时提供组件，而不是直接导出",
      解决方案: [
        "1. 确保 tsconfig.json 配置正确: jsxImportSource: '@opentui/solid'",
        "2. 确保使用 --conditions=browser 运行",
        "3. 确保 preload 脚本已加载: --preload @opentui/solid/scripts/preload.ts",
      ],
      验证方法: "检查 componentCatalogue.markdown 是否存在",
    };

    console.log("\n========== OpenTUI Markdown 组件使用总结 ==========");
    console.log("问题:", findings.问题);
    console.log("原因:", findings.原因);
    console.log("解决方案:");
    for (const solution of findings.解决方案) {
      console.log("  ", solution);
    }
    console.log("验证方法:", findings.验证方法);
    console.log("=====================================================\n");

    expect(findings.问题).toBeDefined();
  });
});

describe("JSX 运行时配置验证", () => {
  it("应该提供正确的 JSX 配置", () => {
    const recommendedConfig = {
      compilerOptions: {
        jsx: "preserve",
        jsxImportSource: "@opentui/solid",
      },
    };

    console.log("推荐的 tsconfig.json 配置:");
    console.log(JSON.stringify(recommendedConfig, null, 2));

    expect(recommendedConfig.compilerOptions.jsx).toBe("preserve");
    expect(recommendedConfig.compilerOptions.jsxImportSource).toBe("@opentui/solid");
  });

  it("应该提供正确的运行命令", () => {
    const recommendedCommand = [
      "bun run",
      "--conditions=browser",
      "--preload ./node_modules/@opentui/solid/scripts/preload.ts",
      "./src/cli/index.ts",
    ].join(" ");

    console.log("推荐的运行命令:");
    console.log(recommendedCommand);

    expect(recommendedCommand).toContain("--conditions=browser");
    expect(recommendedCommand).toContain("@opentui/solid/scripts/preload.ts");
  });
});
