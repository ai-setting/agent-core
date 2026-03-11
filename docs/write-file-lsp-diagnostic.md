# write_file 工具 LSP 诊断机制

> 本文档记录 write_file 工具的 LSP 诊断功能实现流程。

## 概述

`write_file` 工具在写入文件后会自动触发 LSP (Language Server Protocol) 诊断，用于检测文件中的语法错误、链接问题等。当前实现对 Markdown 文件支持检测无效的章节链接。

## 完整执行流程

### 时序图

```
用户请求
    ↓
agent.run
    ↓
env.handle_query
    ↓
env.invokeLLM (调用 LLM)
    ↓
LLM 返回 tool_calls (write_file)
    ↓
env.handle_action → BaseEnvironment.executeAction
    ↓
write_file 写入文件
    ↓
getLSPDiagnosticsForFile() 调用
    ↓
lsp:manager 判断文件类型是否支持 LSP
    ↓
lsp:manager.getClients() 获取 LSP 客户端
    ↓
lsp:manager.touchFile() 打开文档并等待诊断
    ↓
lsp:client.openDocument() 打开文档
    ↓
lsp:client.waitForDiagnostics() 等待诊断结果
    ↓
lsp:manager.getDiagnostics() 获取诊断结果
    ↓
返回结果 (文件写入成功 + LSP 诊断错误)
    ↓
session.addMessage 保存结果
    ↓
env.invokeLLM 继续处理...
```

### 关键日志点

#### 1. 文件工具层 (file.ts)

```
# 入口日志
LSP: Initializing LSP manager for diagnostics...
LSP: LSP manager initialized successfully
LSP: Checking if file needs LSP {filePath, needsLSP: true/false}
LSP: File type not supported for LSP diagnostics

# 触发诊断
LSP: Calling touchFile to trigger diagnostics {filePath, wait: true}
LSP: touchFile completed

# 诊断结果
LSP: Diagnostics processed {filePath, totalDiagnostics, errorCount}
LSP: Returning diagnostics errors {errorCount}
LSP: Error getting diagnostics {filePath, error}
```

#### 2. LSP Manager 层 (lsp/index.ts)

```
# 客户端获取
LSP Manager: Getting clients for file {filePath, ext}
LSP Manager: Skipping server - extension not supported {id, ext, serverExtensions}
LSP Manager: Skipping server - marked as broken {id}
LSP Manager: Root finder result {id, filePath, root}
LSP Manager: Skipping server - no root found
LSP Manager: Using existing client {key, id}
LSP Manager: Clients found {filePath, count}

# 文档操作
LSP Manager: touchFile called {filePath, waitForDiagnostics}
LSP Manager: Got clients for touchFile {filePath, clientCount}
LSP Manager: No clients available for touchFile {filePath}

# 获取诊断
LSP Manager: getDiagnostics called
LSP Manager: Diagnostics from client {root, keys}
LSP Manager: getDiagnostics completed {totalFiles}
```

#### 3. LSP Client 层 (client.ts)

```
# 初始化
Creating LSP client: {id} for {root}
LSP client initialized: {id}
LSP: Sending diagnostic configuration for {id}
LSP: Diagnostic configuration sent for {id}

# 文档操作
LSP: Opening document {filePath, uri, languageId}
LSP: Document opened with content {filePath, contentLength}
LSP: File read failed, opening with empty content {filePath}

# 诊断等待
LSP: Waiting for diagnostics {filePath, timeoutMs}
LSP: Diagnostics received {filePath, count}
LSP: Diagnostics timeout {filePath, timeoutMs}

# 诊断通知
publishDiagnostics received {uri, filePath, diagnosticsCount}
```

### 关键日志片段

```
# 1. 工具执行入口
base-environment.ts:889 - Executing tool {"toolName":"write_file"...}

# 2. LSP 客户端创建
index.ts:142 - lsp:manager: Creating LSP client: markdown
client.ts:146 - lsp:client: Starting LSP server: markdown

# 3. LSP 诊断完成，返回结果
BaseEnvironment.executeAction: Tool result received {
  "toolName":"write_file",
  "success":true,
  "result":"Wrote 128 bytes to ...\n\nLSP errors detected, please fix:\nERROR (7:14) No header found: xxx\nERROR (9:20) No header found: xxx"
}
```

## 日志时间线示例

| 时间 | 组件 | 操作 |
|------|------|------|
| `10:05:14.195` | `env.handle_action` | 开始执行 `write_file` 工具 |
| `10:05:14.208` | `lsp:manager` | 创建 LSP client (markdown) |
| `10:05:14.209` | `lsp:client` | 启动 LSP 服务器 |
| `10:05:19.218` | `lsp:client` | LSP client 初始化完成 (~5秒) |
| `10:05:19.245` | `BaseEnvironment.executeAction` | 返回工具结果 **包含 LSP 诊断** |

## 排查问题指南

### 常见问题

#### 1. LSP 诊断未触发

检查日志：
- `LSP: Initializing LSP manager` - 是否初始化
- `LSP: Checking if file needs LSP` - 文件类型是否支持
- `LSP Manager: Clients found` - 是否有可用客户端
- `LSP Manager: No clients available` - 没有客户端

#### 2. 客户端创建失败

检查日志：
- `Creating LSP client` - 是否尝试创建
- `Failed to start LSP server` - 启动失败原因

#### 3. 诊断结果为空

检查日志：
- `LSP: Waiting for diagnostics` - 是否等待诊断
- `LSP: Diagnostics timeout` - 是否超时
- `publishDiagnostics received` - 是否收到诊断通知

## LSP 诊断输出格式

当检测到问题时，工具返回结果会包含以下格式的诊断信息：

```
Wrote {bytes} bytes to {file_path}

LSP errors detected, please fix:
ERROR 行号:列号 错误信息
```

### 示例

对于包含无效章节链接的 Markdown 文件：

````markdown
# Test Document

这是一个测试文档。

## 相关章节

请参考 [不存在的章节](example#fake-chapter-1) 获取更多信息。

这是一个指向 [另一个不存在的章节](example#fake-chapter-2) 的链接。
````

诊断输出：

```
Wrote 128 bytes to /path/to/test.md

LSP errors detected, please fix:
ERROR (7:14) No header found: fake-chapter-1
ERROR (9:20) No header found: fake-chapter-2
```

## 实现细节

### LSP Manager

- 位置：`packages/core/src/lsp/index.ts`
- 功能：根据文件扩展名创建对应的 LSP 客户端

### LSP Client

- 位置：`packages/core/src/lsp/client.ts`
- 功能：启动 Language Server 并执行诊断

### BaseEnvironment

- 位置：`packages/core/src/environment/base/base-environment.ts`
- 功能：在工具执行完成后调用 LSP 诊断，并将结果附加到返回内容中

## 相关文档

- [LSP 工具设计](./lsp-implementation-design.md)
- [工具调用机制](./agent-core-concepts.md)

---

*本文档最后更新：2026-03-11*
