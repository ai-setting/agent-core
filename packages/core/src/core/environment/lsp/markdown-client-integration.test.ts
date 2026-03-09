/**
 * Integration test for markdown LSP diagnostics using actual agent-core LSP client
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { LSPManager } from "./index.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

describe("Markdown LSP Diagnostics Integration", () => {
  let lspManager: LSPManager;
  let workspacePath: string;
  let testFilePath: string;

  beforeEach(() => {
    // Create test workspace
    workspacePath = join(import.meta.dir, "test-markdown-workspace-integration");
    
    if (existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true });
    }
    mkdirSync(workspacePath, { recursive: true });

    // Create test markdown files
    const targetContent = `# 目标文档

## 第一个章节

这是目标文档的内容。

## 第二个章节

更多内容。
`;

    const testContent = `# 测试文档

## 有效链接

1. 链接到文件：[目标文档](target.md)
2. 链接到章节：[第一个章节](target.md#第一个章节)

## 无效链接（应该有诊断）

1. 链接到不存在的文件：[不存在的文档](not-exist.md)
2. 链接到不存在的章节：[不存在的章节](target.md#不存在的章节)
3. 链接到错误章节名：[错误章节](target.md#错误的章节名)
`;

    writeFileSync(join(workspacePath, "target.md"), targetContent);
    writeFileSync(join(workspacePath, "test.md"), testContent);
    testFilePath = join(workspacePath, "test.md");

    // Create LSP Manager
    lspManager = new LSPManager({});
  });

  afterEach(async () => {
    // Cleanup
    if (existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true });
    }
    // Note: LSPManager doesn't have a stop method, processes will be cleaned up automatically
  });

  it("should get markdown file diagnostics via LSP client", async () => {
    // Touch the markdown file to trigger LSP
    await lspManager.touchFile(testFilePath, true);
    
    // Get diagnostics
    const diagnostics = await lspManager.getDiagnostics();
    
    console.log("Diagnostics received:", JSON.stringify(diagnostics, null, 2));
    
    // Verify diagnostics exist
    const fileDiagnostics = Object.values(diagnostics).flat();
    expect(fileDiagnostics.length).toBeGreaterThan(0);
    
    // Check for expected errors
    const errorMessages = fileDiagnostics.map(d => d.message);
    const hasHeaderError = errorMessages.some(msg => 
      msg.includes("不存在的章节") || msg.includes("错误的章节名")
    );
    
    expect(hasHeaderError).toBe(true);
  }, 30000);
});
