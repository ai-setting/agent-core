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
lsp:manager 创建 LSP client (针对文件类型)
    ↓
LSP 服务器诊断文件
    ↓
返回结果 (文件写入成功 + LSP 诊断错误)
    ↓
session.addMessage 保存结果
    ↓
env.invokeLLM 继续处理...
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

- 位置：`packages/core/src/lsp/manager.ts`
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
