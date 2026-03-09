#!/usr/bin/env node
/**
 * Integration test for markdown LSP diagnostics
 * Tests the full flow: LSP client → markdown language server → diagnostics
 */

import { spawn } from "bun";
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from "vscode-languageserver-protocol";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspacePath = join(__dirname, "test-markdown-workspace");

// Create test workspace
if (existsSync(workspacePath)) {
  rmSync(workspacePath, { recursive: true });
}
mkdirSync(workspacePath);

// Create test files
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

const testFileUri = `file://${join(workspacePath, "test.md")}`;

// Helper to resolve URI to file path
function uriToPath(uri) {
  if (uri.startsWith("file://")) {
    return uri.slice("file://".length);
  }
  return uri;
}

// Start the markdown LSP server
const lsp = spawn("markdown-language-server", ["--stdio"], {
  stdio: ["pipe", "pipe", "pipe"],
});

const reader = new StreamMessageReader(lsp.stdout);
const writer = new StreamMessageWriter(lsp.stdin);

const connection = createMessageConnection(reader, writer);

// Collect diagnostics
const diagnostics: any[] = [];

connection.onNotification("textDocument/publishDiagnostics", (params) => {
  console.log("\n=== PUBLISH DIAGNOSTICS ===");
  console.log("URI:", params.uri);
  console.log("Diagnostics count:", params.diagnostics.length);
  params.diagnostics.forEach((d, i) => {
    console.log(`  [${i + 1}] Line ${d.range.start.line}: ${d.message}`);
    diagnostics.push(d);
  });
});

// Handle required requests
connection.onRequest("markdown/parse", async (params) => {
  const markdownIt = require("markdown-it");
  const md = new markdownIt();
  const text = typeof params.text === "string" ? params.text : "";
  const tokens = md.parse(text, {});
  return tokens;
});

connection.onRequest("markdown/fs/stat", async (params) => {
  const filePath = uriToPath(params.uri);
  try {
    const stats = require("fs").statSync(filePath);
    return {
      type: stats.isDirectory() ? "directory" : "file",
      ctime: stats.birthtime.getTime(),
      mtime: stats.mtime.getTime(),
      size: stats.size,
    };
  } catch (e) {
    return { error: e.message };
  }
});

connection.onRequest("markdown/fs/readDirectory", async (params) => {
  const dirPath = uriToPath(params.uri);
  try {
    const entries = require("fs").readdirSync(dirPath, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? "directory" : "file",
    }));
  } catch (e) {
    return [];
  }
});

connection.onRequest("markdown/fs/readFile", async (params) => {
  const filePath = uriToPath(params.uri);
  try {
    const content = require("fs").readFileSync(filePath, "utf-8");
    return { content };
  } catch (e) {
    return { error: e.message };
  }
});

connection.listen();

async function run() {
  try {
    // Initialize
    console.log("Sending initialize request...");
    const initResult = await connection.sendRequest("initialize", {
      processId: process.pid,
      rootUri: `file://${workspacePath}`,
      capabilities: {
        textDocument: {
          synchronization: {
            willSave: false,
            didSave: true,
            willSaveWaitUntil: false,
          },
        },
      },
    });

    console.log("\n=== INITIALIZE RESULT ===");
    console.log("Server capabilities:");
    if (initResult.capabilities) {
      console.log("  - diagnosticProvider:", initResult.capabilities.diagnosticProvider);
    }

    // Send initialized notification
    connection.sendNotification("initialized", {});

    // Send configuration to enable diagnostics
    console.log("\nSending configuration to enable diagnostics...");
    connection.sendNotification("workspace/didChangeConfiguration", {
      settings: {
        markdown: {
          validate: {
            enabled: true,
            referenceLinks: { enabled: "error" },
            fragmentLinks: { enabled: "error" },
            fileLinks: { enabled: "error", markdownFragmentLinks: "inherit" },
            ignoredLinks: [],
            unusedLinkDefinitions: { enabled: "warning" },
            duplicateLinkDefinitions: { enabled: "warning" },
          },
        },
      },
    });

    // Open document
    const content = readFileSync(join(workspacePath, "test.md"), "utf-8");
    connection.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: testFileUri,
        languageId: "markdown",
        version: 1,
        text: content,
      },
    });

    console.log("\nDocument opened, waiting for diagnostics...");

    // Wait for diagnostics
    await new Promise((r) => setTimeout(r, 3000));

    // Verify diagnostics
    console.log("\n=== VERIFY DIAGNOSTICS ===");
    console.log("Total diagnostics received:", diagnostics.length);

    // Check for expected diagnostics
    const expectedErrors = [
      "not-exist.md", // file not found
      "不存在的章节", // header not found
      "错误的章节名", // wrong header name
    ];

    let foundErrors = 0;
    for (const d of diagnostics) {
      const msg = d.message;
      for (const expected of expectedErrors) {
        if (msg.includes(expected)) {
          foundErrors++;
          console.log(`  ✓ Found expected error: ${msg}`);
          break;
        }
      }
    }

    console.log("\n=== TEST RESULT ===");
    if (foundErrors >= 2 && diagnostics.length >= 2) {
      console.log("✅ PASS: Markdown LSP diagnostics working correctly!");
      console.log(`   Found ${foundErrors} expected errors out of ${diagnostics.length} total`);
    } else {
      console.log("❌ FAIL: Expected more diagnostic errors");
      console.log(`   Expected at least 2 errors, got ${diagnostics.length}`);
    }

    // Cleanup
    rmSync(workspacePath, { recursive: true });
  } catch (e) {
    console.error("Error:", e.message);
    console.error(e.stack);
  }

  setTimeout(() => {
    lsp.kill();
    process.exit(0);
  }, 1000);
}

run();
