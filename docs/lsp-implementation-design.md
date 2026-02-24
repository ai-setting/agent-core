# Agent Core LSP 实现设计文档

> 参考实现：[OpenCode LSP 实现文档](../thirdparty/opencode/LSP-IMPLEMENTATION.md)

## 1. 设计目标

基于 OpenCode 的 LSP 实现经验和 agent-core 的 **Environment 设计理念**，为 agent-core 设计 LSP 机制：

1. **LSP 作为 Environment 的能力**：遵循"能力与约束优先落在 Environment 层"原则
2. **LSP Tool**：让 Agent 可以调用 LSP 进行代码智能查询
3. **代码编辑集成诊断**：WriteTool/EditTool 执行后自动获取并返回 LSP 错误
4. **统一工具抽象**：LSP 客户端/服务器作为 Environment 内部实现，暴露统一工具接口

---

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Agent / Tool Layer                                  │
│  - LspTool (代码智能查询)                                                  │
│  - write_file / edit (文件编辑后自动诊断)                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    BaseEnvironment (LSP 能力入口)                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ - registerLSPTool() 注册 LSP 工具                                    │  │
│  │ - getLSPClients(file) 获取 LSP 客户端                                │  │
│  │ - lspDiagnostics(file) 获取诊断                                      │  │
│  │ - onLSPDiagnostics 事件钩子                                         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LSP Module                                          │
│  packages/core/src/core/environment/lsp/                                   │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐          │
│  │   index.ts   │   client.ts  │   server.ts  │ language.ts  │          │
│  │  (API 入口)  │ (JSON-RPC)   │ (服务器定义)  │ (扩展名映射) │          │
│  └──────────────┴──────────────┴──────────────┴──────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                           JSON-RPC over stdio
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LSP Server (外部进程)                                    │
│  - TypeScript (tsserver)                                                  │
│  - Pyright (Python)                                                       │
│  - Gopls (Go)                                                             │
│  - Rust Analyzer (Rust)                                                   │
│  ...                                                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 与 agent-core 现有组件的关系

```
BaseEnvironment
    │
    ├── tools: Map<string, Tool>
    │       │
    │       ├── + registerLSPTool()  ← 新增 LSP 工具注册
    │       └── + registerFileToolsWithLSP()  ← 新增文件工具+LSP 集成
    │
    ├── prompts: Map<string, Prompt>
    │
    ├── streams: Map<string, LLMStream>
    │
    └── hooks
            │
            └── + onLSPDiagnostics  ← 新增 LSP 诊断事件

LSP 事件流程：
┌─────────────────────────────────────────────────────────────────────────┐
│                         LSP 服务器 (外部进程)                            │
│   - pyright (Python)                                                  │
│   - tsserver (TypeScript)                                             │
│   - gopls (Go)                                                        │
│   - rust-analyzer (Rust)                                              │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ textDocument/publishDiagnostics
                                  │ (JSON-RPC notification)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         LSP Client                                      │
│   connection.onNotification("textDocument/publishDiagnostics", ...)    │
│       │                                                               │
│       │ 1. 存储诊断到内存 Map                                          │
│       │ 2. 发布 Bus 事件 (Event.Diagnostics)                          │
│       ▼                                                               │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         事件订阅者                                       │
│   ┌─────────────┬─────────────┬─────────────┐                         │
│   │ TUI 显示    │ Agent 获取   │ SSE 推送    │                         │
│   └─────────────┴─────────────┴─────────────┘                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心模块设计

### 3.1 目录结构

```
packages/core/src/core/environment/lsp/
├── index.ts           # LSP API 入口，导出 namespace
├── client.ts          # LSP 客户端实现 (JSON-RPC over stdio)
├── server.ts          # LSP 服务器定义 (支持的语言列表)
├── language.ts        # 文件扩展名 → 语言 ID 映射
├── diagnostics.ts    # 诊断相关类型与工具函数
└── index.ts          # 模块导出入口
```

### 3.2 核心类型定义

#### LSP 诊断类型

```typescript
// packages/core/src/core/environment/lsp/diagnostics.ts

export interface LSPDiagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: 1 | 2 | 3 | 4;  // 1=Error, 2=Warn, 3=Info, 4=Hint
  message: string;
  source?: string;
}

export type DiagnosticSeverity = {
  ERROR: 1;
  WARNING: 2;
  INFO: 3;
  HINT: 4;
};

export function formatDiagnostic(diagnostic: LSPDiagnostic): string {
  const severityMap = { 1: "ERROR", 2: "WARN", 3: "INFO", 4: "HINT" };
  const severity = severityMap[diagnostic.severity] || "ERROR";
  const line = diagnostic.range.start.line + 1;
  const col = diagnostic.range.start.character + 1;
  return `${severity} [${line}:${col}] ${diagnostic.message}`;
}
```

#### LSP 客户端接口

```typescript
// packages/core/src/core/environment/lsp/client.ts

export interface LSPClientInfo {
  serverID: string;
  root: string;
  connection: MessageConnection;
  
  // 通知方法
  notifyOpenFile(path: string): Promise<void>;
  notifyChangeFile(path: string, content: string): Promise<void>;
  
  // 诊断
  getDiagnostics(): Map<string, LSPDiagnostic[]>;
  waitForDiagnostics(path: string, timeoutMs?: number): Promise<void>;
  
  // 生命周期
  shutdown(): Promise<void>;
}

export interface LSPClientFactory {
  create(input: {
    serverID: string;
    server: LSPServerHandle;
    root: string;
  }): Promise<LSPClientInfo>;
}
```

#### LSP 服务器接口

```typescript
// packages/core/src/core/environment/lsp/server.ts

export interface LSPServerHandle {
  process: ChildProcessWithoutNullStreams;
  initializationOptions?: Record<string, unknown>;
}

export interface LSPServerInfo {
  id: string;
  extensions: string[];  // 支持的文件扩展名
  global?: boolean;
  
  // 查找项目根目录
  findRoot(file: string): Promise<string | undefined>;
  
  // 启动服务器
  spawn(root: string): Promise<LSPServerHandle | undefined>;
}

// 预定义服务器
export const LSPServers = {
  typescript: LSPServerInfo;
  pyright: LSPServerInfo;
  gopls: LSPServerInfo;
  rustAnalyzer: LSPServerInfo;
  // ... 更多
} as const;
```

### 3.3 LSP Namespace API

```typescript
// packages/core/src/core/environment/lsp/index.ts

import { z } from "zod";
import { EventEmitter } from "events";
import { LSPClientInfo, LSPDiagnostic } from "./client";
import { LSPServerInfo, LSPServers } from "./server";
import { createLogger } from "../../../utils/logger.js";

export const lspLogger = createLogger("lsp", "server.log");

export const LSPOperations = [
  "goToDefinition",
  "findReferences", 
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
] as const;

export const LSPOperationSchema = z.enum(LSPOperations);

export interface LSPToolParams {
  operation: z.infer<typeof LSPOperationSchema>;
  filePath: string;
  line: number;
  character: number;
}

// LSP 状态管理
export class LSPManager extends EventEmitter {
  private clients: Map<string, LSPClientInfo> = new Map();
  private spawning: Map<string, Promise<LSPClientInfo | undefined>> = new Map();
  private servers: Map<string, LSPServerInfo> = new Map();
  private broken: Set<string> = new Set();
  
  constructor(servers?: Partial<Record<string, LSPServerInfo>>) {
    super();
    // 初始化默认服务器
    for (const [id, server] of Object.entries(LSPServers)) {
      this.servers.set(id, server);
    }
    // 允许覆盖默认服务器
    if (servers) {
      for (const [id, server] of Object.entries(servers)) {
        this.servers.set(id, server);
      }
    }
  }
  
  // 获取文件对应的 LSP 客户端
  async getClients(filePath: string): Promise<LSPClientInfo[]> {
    const ext = path.extname(filePath);
    const result: LSPClientInfo[] = [];
    
    for (const [id, server] of this.servers) {
      if (!server.extensions.includes(ext)) continue;
      
      const root = await server.findRoot(filePath);
      if (!root) continue;
      if (this.broken.has(root + id)) continue;
      
      // 检查是否已有客户端
      const existing = Array.from(this.clients.values())
        .find(c => c.root === root && c.serverID === id);
      if (existing) {
        result.push(existing);
        continue;
      }
      
      // 创建新客户端
      const client = await this.getOrCreateClient(id, server, root);
      if (client) result.push(client);
    }
    
    return result;
  }
  
  // 获取或创建客户端
  private async getOrCreateClient(
    id: string, 
    server: LSPServerInfo, 
    root: string
  ): Promise<LSPClientInfo | undefined> {
    const key = root + id;
    
    if (this.spawning.has(key)) {
      return this.spawning.get(key);
    }
    
    const task = this.createClient(id, server, root);
    this.spawning.set(key, task);
    
    try {
      const client = await task;
      if (client) {
        this.clients.set(key, client);
        this.emit("clientCreated", client);
      }
      return client;
    } catch (error) {
      this.broken.add(key);
      lspLogger.error(`Failed to create LSP client ${id}`, { error });
      return undefined;
    } finally {
      this.spawning.delete(key);
    }
  }
  
  // 创建客户端
  private async createClient(
    id: string,
    server: LSPServerInfo,
    root: string
  ): Promise<LSPClientInfo | undefined> {
    const handle = await server.spawn(root);
    if (!handle) return undefined;
    
    // 创建 JSON-RPC 连接
    const connection = createMessageConnection(
      new StreamMessageReader(handle.process.stdout),
      new StreamMessageWriter(handle.process.stdin),
    );
    
    // 初始化客户端
    const client = await LSPClientFactory.create({
      serverID: id,
      server: handle,
      root,
      initializationOptions: handle.initializationOptions,
    });
    
    return client;
  }
  
  // 打开文件并等待诊断
  async touchFile(filePath: string, waitForDiagnostics = false): Promise<void> {
    const clients = await this.getClients(filePath);
    
    await Promise.all(clients.map(async (client) => {
      const wait = waitForDiagnostics 
        ? client.waitForDiagnostics(filePath, 3000)
        : Promise.resolve();
      
      await client.notifyOpenFile(filePath);
      return wait;
    }));
  }
  
  // 获取所有诊断
  async getDiagnostics(): Promise<Record<string, LSPDiagnostic[]>> {
    const results: Record<string, LSPDiagnostic[]> = {};
    
    for (const client of this.clients.values()) {
      const diags = client.getDiagnostics();
      for (const [path, diags] of diags) {
        results[path] = (results[path] || []).concat(diags);
      }
    }
    
    return results;
  }
  
  // 执行 LSP 操作
  async executeOperation(
    operation: z.infer<typeof LSPOperationSchema>,
    filePath: string,
    line: number,
    character: number
  ): Promise<unknown[]> {
    const clients = await this.getClients(filePath);
    const uri = pathToFileURL(filePath).href;
    const position = { line: line - 1, character: character - 1 };
    
    const tasks = clients.map(client => {
      switch (operation) {
        case "goToDefinition":
          return client.connection.sendRequest("textDocument/definition", {
            textDocument: { uri },
            position,
          });
        case "findReferences":
          return client.connection.sendRequest("textDocument/references", {
            textDocument: { uri },
            position,
            context: { includeDeclaration: true },
          });
        case "hover":
          return client.connection.sendRequest("textDocument/hover", {
            textDocument: { uri },
            position,
          });
        // ... 其他操作
        default:
          return Promise.resolve(null);
      }
    });
    
    const results = await Promise.all(tasks);
    return results.flat().filter(Boolean);
  }
  
  // 关闭所有客户端
  async shutdown(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.shutdown();
    }
    this.clients.clear();
  }
}

// 导出单例
export const lspManager = new LSPManager();
```

---

## 4. 工具设计

### 4.1 LSP Tool

```typescript
// packages/core/src/core/environment/lsp/lsp-tool.ts

import { z } from "zod";
import type { ToolInfo } from "../../types/tool.js";
import { lspManager } from "./index.js";
import { formatDiagnostic } from "./diagnostics.js";
import path from "path";

const LSP_TOOL_NAME = "lsp";

const operationSchema = z.enum([
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
]);

export const lspToolDescription = `
Interact with Language Server Protocol (LSP) servers to get code intelligence features.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols in a document
- workspaceSymbol: Search for symbols across the workspace
- goToImplementation: Find implementations of an interface

All operations require:
- filePath: The file to operate on
- line: The line number (1-based)
- character: The character offset (1-based)
`.trim();

export function createLSPTool(): ToolInfo {
  return {
    name: LSP_TOOL_NAME,
    description: lspToolDescription,
    parameters: z.object({
      operation: operationSchema.describe("The LSP operation to perform"),
      filePath: z.string().describe("The absolute or relative path to the file"),
      line: z.number().int().min(1).describe("The line number (1-based)"),
      character: z.number().int().min(1).describe("The character offset (1-based)"),
    }),
    execute: async (args, ctx) => {
      const workdir = ctx.workdir || process.cwd();
      const filePath = path.isAbsolute(args.filePath) 
        ? args.filePath 
        : path.join(workdir, args.filePath);
      
      // 检查文件是否存在
      const fs = await import("fs/promises");
      try {
        await fs.access(filePath);
      } catch {
        return {
          success: false,
          output: "",
          error: `File not found: ${filePath}`,
        };
      }
      
      // 检查是否有可用的 LSP 服务器
      const hasLSP = await lspManager.hasLSPForFile(filePath);
      if (!hasLSP) {
        return {
          success: false,
          output: "",
          error: "No LSP server available for this file type",
        };
      }
      
      // 执行 LSP 操作
      const result = await lspManager.executeOperation(
        args.operation,
        filePath,
        args.line,
        args.character,
      );
      
      if (result.length === 0) {
        return {
          success: true,
          output: `No results found for ${args.operation}`,
        };
      }
      
      return {
        success: true,
        output: JSON.stringify(result, null, 2),
        metadata: {
          operation: args.operation,
          filePath,
          result,
        },
      };
    },
  };
}
```

### 4.2 文件工具集成 LSP 诊断

> **优化设计**：只有代码文件才进行 LSP 诊断，非代码文件（如 .md、.txt、.json 等）跳过 LSP 以提升性能。

#### 文件类型过滤

```typescript
// packages/core/src/core/environment/lsp/language.ts

// 需要 LSP 诊断的代码文件扩展名
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".py", ".pyi",
  ".go",
  ".rs",
  ".java", ".kt", ".kts",
  ".cpp", ".c", ".h", ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".zig",
  ".vue", ".svelte", ".astro",
]);

// 判断文件是否需要 LSP 诊断
export function needsLSPDiagnostics(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return CODE_EXTENSIONS.has(ext);
}
```

#### Write Tool 集成

```typescript
// packages/core/src/core/environment/expend/os/tools/file.ts

import { lspManager } from "../../lsp/index.js";
import { formatDiagnostic, LSPDiagnostic, needsLSPDiagnostics } from "../../lsp/language.js";

const MAX_DIAGNOSTICS_PER_FILE = 20;
const MAX_OTHER_FILES_DIAGNOSTICS = 5;

// 在 write_file 工具执行后添加诊断获取
export async function writeFileWithDiagnostics(
  filePath: string,
  content: string,
  options?: WriteFileOptions
): Promise<{
  success: boolean;
  output: string;
  diff?: string;
  diagnostics?: Record<string, LSPDiagnostic[]>;
}> {
  // 1. 执行写文件
  const result = await writeFile(filePath, content, options);
  
  if (!result.success) {
    return result;
  }
  
  // 2. 判断是否需要 LSP 诊断（非代码文件跳过）
  if (!needsLSPDiagnostics(filePath)) {
    return {
      ...result,
      output: result.output,
    };
  }
  
  // 3. 通知 LSP 并等待诊断
  await lspManager.touchFile(filePath, true);
  
  // 4. 获取诊断
  const allDiagnostics = await lspManager.getDiagnostics();
  const normalizedPath = normalizePath(filePath);
  const fileDiagnostics = allDiagnostics[normalizedPath] || [];
  
  // 5. 过滤 Error 级别
  const errors = fileDiagnostics.filter(d => d.severity === 1);
  
  // 6. 构建输出
  let output = result.output;
  if (errors.length > 0) {
    const limited = errors.slice(0, MAX_DIAGNOSTICS_PER_FILE);
    const suffix = errors.length > MAX_DIAGNOSTICS_PER_FILE
      ? `\n... and ${errors.length - MAX_DIAGNOSTICS_PER_FILE} more`
      : "";
    
    output += `\n\nLSP errors detected, please fix:
${limited.map(formatDiagnostic).join("\n")}${suffix}`;
  }
  
  // 7. 检查其他文件的错误（限制数量）
  let otherFilesCount = 0;
  for (const [path, diags] of Object.entries(allDiagnostics)) {
    if (path === normalizedPath) continue;
    if (otherFilesCount >= MAX_OTHER_FILES_DIAGNOSTICS) break;
    
    const fileErrors = diags.filter(d => d.severity === 1);
    if (fileErrors.length > 0) {
      otherFilesCount++;
      output += `\n\nLSP errors in ${path}:
${fileErrors.slice(0, 5).map(formatDiagnostic).join("\n")}`;
    }
  }
  
  return {
    ...result,
    output,
    diagnostics: allDiagnostics,
  };
}

// 修改 write_file 工具
export function createFileToolsWithLSP(): ToolInfo[] {
  const tools = createFileTools();
  
  // 替换 write_file 工具
  const writeTool = tools.find(t => t.name === "write_file");
  if (writeTool) {
    writeTool.execute = async (args, ctx) => {
      const result = await writeFileWithDiagnostics(
        args.path,
        args.content,
        { append: args.append, createDirectories: args.createDirs, diff: args.showDiff }
      );
      
      return {
        success: result.success,
        output: result.output,
        error: result.success ? undefined : result.output,
        metadata: {
          execution_time_ms: Date.now(),
          output_size: args.content?.length || 0,
          file_path: args.path,
          diagnostics: result.diagnostics,
        },
      };
    };
  }
  
  return tools;
}
```

---

## 5. Environment 集成

### 5.1 BaseEnvironment 扩展

```typescript
// packages/core/src/core/environment/base/base-environment.ts

export abstract class BaseEnvironment implements Environment {
  // ... 现有属性
  
  // LSP 管理器
  protected lspManager?: LSPManager;
  
  // 注册 LSP 工具
  registerLSPTool(): void {
    const { createLSPTool } = require("../lsp/lsp-tool.js");
    this.registerTool(createLSPTool());
    this.lspLogger.info("LSP tool registered");
  }
  
  // 注册文件工具（带 LSP 诊断）
  registerFileToolsWithLSP(): void {
    const { createFileToolsWithLSP } = require("../expend/os/tools/file.js");
    const tools = createFileToolsWithLSP();
    for (const tool of tools) {
      this.registerTool(tool);
    }
    this.lspLogger.info("File tools with LSP diagnostics registered");
  }
  
  // 初始化 LSP
  async initLSP(config?: LSPConfig): Promise<void> {
    this.lspManager = new LSPManager(config?.servers);
    await this.registerLSPTool();
    await this.registerFileToolsWithLSP();
    this.lspLogger.info("LSP initialized");
  }
  
  // 获取 LSP 诊断
  async getLSPDiagnostics(): Promise<Record<string, LSPDiagnostic[]>> {
    if (!this.lspManager) {
      return {};
    }
    return this.lspManager.getDiagnostics();
  }
  
  // 触发文件 LSP 更新
  async touchFileForLSP(filePath: string, waitForDiagnostics = false): Promise<void> {
    if (!this.lspManager) return;
    await this.lspManager.touchFile(filePath, waitForDiagnostics);
  }
}
```

### 5.2 LSP 配置

```typescript
// packages/core/src/core/environment/lsp/config.ts

export interface LSPConfig {
  // 禁用所有 LSP
  disabled?: boolean;
  
  // 服务器配置
  servers?: Partial<Record<string, {
    disabled?: boolean;
    command?: string[];
    env?: Record<string, string>;
    extensions?: string[];
    initializationOptions?: Record<string, unknown>;
  }>>;
}
```

### 5.1 用户配置文件示例

```jsonc
// agent-core.jsonc
{
  "lsp": {
    // 全局禁用所有 LSP
    "disabled": false,
    
    "servers": {
      // 覆盖默认 pyright 配置
      "pyright": {
        "disabled": false,
        "command": ["pyright-langserver", "--stdio"],
        "extensions": [".py", ".pyi"],
        "env": {
          "PYTHONPATH": "/custom/path"
        }
      },
      
      // 禁用默认的 typescript 服务器
      "typescript": {
        "disabled": true
      },
      
      // 添加自定义 LSP 服务器
      "custom-lsp": {
        "disabled": false,
        "command": ["/path/to/custom-lsp", "--stdio"],
        "extensions": [".custom"],
        "initializationOptions": {
          "someOption": true
        }
      }
    }
  }
}
```

### 5.2 默认服务器配置

系统内置默认 LSP 服务器配置（可被用户配置覆盖）：

```typescript
// packages/core/src/core/environment/lsp/server.ts

export const DEFAULT_LSP_SERVERS = {
  typescript: {
    id: "typescript",
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    command: ["typescript-language-server", "--stdio"],
    rootPatterns: ["package-lock.json", "bun.lock"],
    excludePatterns: ["deno.json", "deno.jsonc"],
  },
  
  pyright: {
    id: "pyright",
    extensions: [".py", ".pyi"],
    command: ["pyright-langserver", "--stdio"],
    rootPatterns: ["pyproject.toml", "requirements.txt", "setup.py"],
  },
  
  gopls: {
    id: "gopls",
    extensions: [".go"],
    command: ["gopls"],
    rootPatterns: ["go.mod", "go.work"],
  },
  
  rustAnalyzer: {
    id: "rust",
    extensions: [".rs"],
    command: ["rust-analyzer"],
    rootPatterns: ["Cargo.toml"],
  },
  
  // 更多服务器...
} as const;
```

// 从配置文件加载 LSP 配置
export async function loadLSPConfig(workdir: string): Promise<LSPConfig | undefined> {
  const configPaths = [
    path.join(workdir, "agent-core.json"),
    path.join(workdir, "agent-core.jsonc"),
  ];
  
  for (const configPath of configPaths) {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      const config = JSON.parse(content);
      return config.lsp;
    } catch {
      // 继续尝试下一个
    }
  }
  
  return undefined;
}
```

---

## 6. 事件机制

### 6.1 LSP 事件详细流程

#### 事件从哪里来？

**LSP 事件由外部 LSP 服务器（如 pyright、tsserver、gopls）主动推送**。

```
LSP 服务器 (外部进程)
    │
    │  textDocument/publishDiagnostics notification
    │  (JSON-RPC over stdio)
    ▼
LSP Client (我们的代码)
    │
    │  1. 存储诊断到内存 Map
    │  2. 发布 Bus 事件
    ▼
EventBus / Bus
    │
    │  订阅者收到事件
    ▼
TUI 显示 / Agent 获取 / SSE 推送
```

#### 事件如何触发？

**触发方式一：文件变更触发**
```
用户调用 write_file 工具
    │
    ▼
writeFileWithDiagnostics(filePath)
    │
    ▼
lspManager.touchFile(filePath, true)
    │
    ├── client.notifyOpenFile(path)  // 发送 textDocument/didOpen 通知
    │       │
    │       │  LSP 服务器开始分析
    │       ▼
    │   LSP 服务器推送 publishDiagnostics
    │
    └── client.waitForDiagnostics()  // 等待诊断结果
```

**触发方式二：LSP 服务器主动推送**
```
LSP 服务器后台持续分析
    │
    ├── 检测到代码问题
    │       │
    │       ▼
    │   立即推送 publishDiagnostics（不等待请求）
    │
    └── 实时推送诊断更新
```

#### 事件输出有什么用？

| 使用场景 | 说明 | 示例 |
|---------|------|------|
| **TUI 显示** | 在界面上实时显示错误标记 | 红色波浪线、错误面板 |
| **Agent 获取** | write_file 后获取诊断，返回给 LLM | "LSP errors detected, please fix..." |
| **SSE 推送** | 推送诊断到客户端实时展示 | `/events` 端点推送 |
| **自动修复** | Agent 可根据诊断自动修复代码 | 读取诊断 → 修复代码 |

#### LSP 客户端监听诊断代码示例

```typescript
// packages/core/src/core/environment/lsp/client.ts

connection.onNotification("textDocument/publishDiagnostics", (params) => {
  const filePath = fileURLToPath(params.uri);
  
  // 1. 存储到内存 Map
  diagnostics.set(filePath, params.diagnostics);
  
  // 2. 发布 Bus 事件，通知订阅者
  Bus.publish(Event.Diagnostics, {
    path: filePath,
    serverID: serverID,
    diagnostics: params.diagnostics,
  });
  
  // 3. 如果有等待者，resolve Promise
  if (waitingForDiagnostics.has(filePath)) {
    waitingForDiagnostics.get(filePath)?.resolve();
  }
});
```

### 6.2 LSP 诊断事件类型

```typescript
// packages/core/src/core/types/event.ts

export const EventTypes = {
  // ... 现有事件
  
  // LSP 事件
  LSP_DIAGNOSTICS: "lsp.diagnostics",
  LSP_CLIENT_CREATED: "lsp.clientCreated",
  LSP_CLIENT_ERROR: "lsp.clientError",
} as const;

export interface LSPDiagnosticsEvent {
  type: typeof EventTypes.LSP_DIAGNOSTICS;
  filePath: string;
  diagnostics: LSPDiagnostic[];
  serverID: string;
}

export interface LSPClientCreatedEvent {
  type: typeof EventTypes.LSP_CLIENT_CREATED;
  serverID: string;
  root: string;
}
```

---

### 6.3 LSP 事件通过 SSE 推送到前端

#### 整体流程

```
LSP Client 收到诊断
    │
    │ Bus.publish(Event.Diagnostics, {...})
    ▼
EventBus (server/eventbus/bus.ts)
    │
    │ publishGlobal() / subscribeToSession()
    ▼
SSE Endpoint (server/routes/events.ts)
    │
    │ /events?sessionId=xxx
    ▼
前端 EventSource 连接
    │
    │ event-stream.tsx 处理
    ▼
TUI 界面展示诊断
```

#### EventBus 发布 LSP 事件

```typescript
// LSP Client 中发布诊断事件
import { Bus } from "../../../server/eventbus/index.js";
import { EventTypes } from "../../types/event.js";

// 发布诊断事件
Bus.publish(
  { type: EventTypes.LSP_DIAGNOSTICS, properties: {} as any },
  {
    filePath: filePath,
    diagnostics: params.diagnostics,
    serverID: serverID,
  }
);
```

#### SSE Endpoint 已有实现

SSE 端点已存在，直接复用即可：

```typescript
// server/routes/events.ts 已有的 SSE 处理
app.get("/", async (c) => {
  return streamSSE(c, async (stream) => {
    // 1. 发送连接成功事件
    await stream.writeSSE({ data: JSON.stringify({ type: "server.connected" }) });

    // 2. 订阅 session 事件
    const unsubscribe = subscribeToSession(sessionId, async (event) => {
      // 3. 事件扁平化后推送
      const flattenedEvent = {
        type: event.type,
        ...(event.properties as object),
      };
      await stream.writeSSE({ data: JSON.stringify(flattenedEvent) });
    });

    // 4. 心跳保持连接
    const heartbeat = setInterval(async () => {
      await stream.writeSSE({ 
        data: JSON.stringify({ type: "server.heartbeat", timestamp: Date.now() }) 
      });
    }, 5000);
  });
});
```

#### 前端 EventStream 处理

前端已有事件处理框架 (`cli/tui/contexts/event-stream.tsx`)，只需添加 LSP 诊断事件处理：

```typescript
// cli/tui/contexts/event-stream.tsx handleEvent() 中添加

case "lsp.diagnostics": {
  eventLogger.debug("LSP diagnostics received", { 
    filePath: event.filePath,
    count: event.diagnostics?.length 
  });
  
  // 存储诊断到 store
  store.setLSPDiagnostics((prev) => ({
    ...prev,
    [event.filePath]: event.diagnostics || [],
  }));
  break;
}
```

#### TUI 简单展示诊断

```typescript
// cli/tui/components/DiagnosticsPanel.tsx

import { createSignal, For, Show } from "solid-js";
import { useStore } from "../contexts/store";

export function DiagnosticsPanel() {
  const store = useStore();
  const diagnostics = () => store.lspDiagnostics() || {};
  
  const totalErrors = () => {
    let count = 0;
    for (const diags of Object.values(diagnostics())) {
      count += diags.filter(d => d.severity === 1).length;
    }
    return count;
  };
  
  return (
    <Show when={totalErrors() > 0}>
      <panel title={` LSP Errors: ${totalErrors()}`}>
        <For each={Object.entries(diagnostics())}>
          {([filePath, diags]) => (
            <For each={diags.filter(d => d.severity === 1).slice(0, 5)}>
              {(diag) => (
                <text fg="red">
                  {diag.range.start.line + 1}:{diag.range.start.character + 1} {diag.message}
                </text>
              )}
            </For>
          )}
        </For>
      </panel>
    </Show>
  );
}
```

### 6.4 前端展示效果

```
┌─────────────────────────────────────────────────────────────────┐
│  > write_file: src/utils/helper.ts                             │
│  ✓ Success                                                     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ ⚠ LSP Errors: 2                                        │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ src/utils/helper.ts                                     │  │
│  │   10:5 Cannot find name 'foo'                          │  │
│  │   15:2 Property 'bar' does not exist on type 'Helper' │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. 实现步骤

### Phase 1: 基础 LSP 框架

1. 创建 `packages/core/src/core/environment/lsp/` 目录结构
2. 实现 `language.ts` - 文件扩展名映射
3. 实现 `diagnostics.ts` - 诊断类型与工具函数
4. 实现 `server.ts` - LSP 服务器定义（支持 TypeScript/Python/Go/Rust）

### Phase 2: LSP 客户端

1. 实现 `client.ts` - JSON-RPC 客户端
2. 实现 `index.ts` - LSP Manager
3. 实现 `lsp-tool.ts` - LSP Tool

### Phase 3: 文件工具集成

1. 修改 `file.ts` - write_file 集成诊断
2. 添加 `edit-tool.ts` - edit 工具（如果需要）
3. 配置加载与初始化

### Phase 4: 事件与可观测

1. 添加 LSP 事件类型 (`core/types/event.ts`)
2. 集成 EventBus (`LSP Client` 中 publish)
3. SSE 推送诊断事件（复用现有 `/events` 端点）
4. 前端事件处理（`event-stream.tsx` 添加 `lsp.diagnostics` 处理）
5. TUI 诊断面板组件展示

---

## 8. 关键文件路径

| 功能 | 文件路径 |
|------|----------|
| LSP 模块入口 | `packages/core/src/core/environment/lsp/index.ts` |
| LSP 客户端 | `packages/core/src/core/environment/lsp/client.ts` |
| LSP 服务器定义 | `packages/core/src/core/environment/lsp/server.ts` |
| 语言扩展映射 | `packages/core/src/core/environment/lsp/language.ts` |
| 诊断类型 | `packages/core/src/core/environment/lsp/diagnostics.ts` |
| LSP Tool | `packages/core/src/core/environment/lsp/lsp-tool.ts` |
| 文件工具（含诊断） | `packages/core/src/core/environment/expend/os/tools/file.ts` |
| BaseEnvironment 扩展 | `packages/core/src/core/environment/base/base-environment.ts` |
| 事件类型 | `packages/core/src/core/types/event.ts` |
| LSP 配置类型 | `packages/core/src/core/environment/lsp/config.ts` |
| SSE 端点 | `packages/core/src/server/routes/events.ts` |
| EventBus | `packages/core/src/server/eventbus/bus.ts` |
| 前端事件处理 | `packages/core/src/cli/tui/contexts/event-stream.tsx` |
| 前端诊断面板 | `packages/core/src/cli/tui/components/diagnostics-panel.tsx` (新建) |

---

## 9. 参考资料

- [OpenCode LSP 实现文档](../thirdparty/opencode/LSP-IMPLEMENTATION.md)
- [Environment 设计理念](../environment-design-philosophy.md)
- [agent-core 现有工具实现](./expend/os/tools/file.ts)
