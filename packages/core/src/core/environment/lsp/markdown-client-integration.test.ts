/**
 * Integration test for markdown LSP diagnostics using actual agent-core LSP client
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { LSPClient } from "./client.js";
import { LSPServers } from "./server.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

describe("Markdown LSP Diagnostics Integration", () => {
  let workspacePath: string;
  let testFilePath: string;
  let client: LSPClient;

  beforeEach(() => {
    // Use a fixed workspace path like the example
    workspacePath = '/home/dzk/work/codework/personal/tong_work/agent-core/test-workspace-integration';
    
    if (existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true });
    }
    mkdirSync(workspacePath, { recursive: true });

    // Create package.json to mark workspace root (required by markdown LSP)
    writeFileSync(join(workspacePath, "package.json"), JSON.stringify({ name: "test-workspace" }, null, 2));

    const targetContent = `# 目标文档

## 第一个章节

这是目标文档的内容。

## 第二个章节

更多内容。
`;

    const testContent = `# Test Markdown Document

## Normal Section

This is normal content.

## Problem Section

This has a [broken link](#nonexistent-section).

This has a [broken reference][nonexistent-ref].

## Code Block

\`\`\`typescript
const x: number = "hello";
\`\`\`
`;

    writeFileSync(join(workspacePath, "target.md"), targetContent);
    writeFileSync(join(workspacePath, "test.md"), testContent);
    testFilePath = join(workspacePath, "test.md");

    // Create LSP Client directly
    client = new LSPClient({
      serverID: 'markdown',
      server: LSPServers.markdown,
      root: workspacePath,
    });
  });

  afterEach(async () => {
    try {
      await client.shutdown();
    } catch {}
    
    if (existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true });
    }
  });

  it("should get markdown file diagnostics via LSP client", async () => {
    console.log("Workspace path:", workspacePath);
    console.log("Test file path:", testFilePath);
    console.log("Files in workspace:", existsSync(join(workspacePath, "package.json")), existsSync(join(workspacePath, "test.md")), existsSync(join(workspacePath, "target.md")));
    
    // Subscribe to diagnostics
    const diagnosticsResult: Array<{ filePath: string; diagnostics: any[] }> = [];
    client.on('diagnostics', (data) => {
      console.log('Diagnostics event:', data);
      diagnosticsResult.push(data);
    });

    client.on('error', (error) => {
      console.error('Client error:', error);
    });

    // Start and initialize
    await client.start();
    console.log('Client started');
    await client.initialize();
    console.log('Client initialized');

    // Open document
    await client.openDocument(testFilePath);
    console.log('Document opened');

    // Wait for diagnostics - longer wait
    console.log('Waiting for diagnostics...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check cache
    const cached = client.getDiagnostics();
    console.log('Cached diagnostics:', Array.from(cached.entries()));

    // Get diagnostics
    const diagnostics = await client.getDiagnosticsAsync(testFilePath);
    
    console.log("Diagnostics received:", diagnostics.length);
    console.log("Diagnostics events:", diagnosticsResult.length);
    
    expect(diagnostics.length).toBeGreaterThan(0);

    const hasHeaderError = diagnostics.some(d => 
      d.message.includes("nonexistent-section") || d.message.includes("nonexistent-ref")
    );
    
    expect(hasHeaderError).toBe(true);
  }, 30000);
});
