# Agent Core - Quick Start

## 最小可用集 (MVP)

Agent Core 是一个轻量级 AI Agent 框架，支持工具调用、错误恢复和流式事件。

## 核心特性

- **工具调用**: 注册和执行自定义工具
- **LLM 集成**: 支持 OpenAI 格式的适配器 (Anthropic, OpenAI, MiniMax 等)
- **错误恢复**: 重试、降级、超时控制
- **并发管理**: 限制并发执行数量
- **流式事件**: 通过 EventBus 广播 SSE 事件
- **Session 持久化**: SQLite 存储对话历史

## 安装

```bash
npm install
```

## 基础用法

### 1. 创建环境

```typescript
import { ServerEnvironment } from "@agent-core/core";

const env = new ServerEnvironment();

// 等待配置加载
await env.waitForReady();
```

### 2. 处理查询

```typescript
const response = await env.handle_query(
  "你好，请帮我读取当前目录下的 package.json 文件",
  { session_id: "session-001" }
);

console.log(response);
```

### 3. 使用 OsEnv (包含文件工具)

```typescript
import { OsEnv } from "@agent-core/core";

class MyOsEnv extends OsEnv {
  // 继承所有 OS 工具 (bash, read_file, write_file, glob, grep)
}

const env = new MyOsEnv();
await env.waitForReady();
```

## 错误处理

框架内置以下错误恢复机制：

- **超时控制**: 可配置全局/工具级超时
- **重试机制**: 指数退避重试临时错误
- **Doom Loop 检测**: 防止相同工具无限循环调用
- **并发限制**: 防止资源耗尽

## 流式事件

通过 SSE 端点订阅事件流：

```bash
curl -N http://localhost:4096/events?sessionId=session-001
```

事件类型: start, text, reasoning, tool_call, tool_result, completed, error, session.created, session.updated, background_task.*, timer.*

## 运行测试

```bash
# 运行所有测试
npm test

# 运行类型检查
npm run typecheck

# 运行测试覆盖率
npm run test:coverage
```

## 当前状态

- ✅ 249+ 个测试全部通过
- ✅ TypeScript 类型检查通过
- ✅ 测试覆盖率: 84.89% 函数, 89.76% 行
- ✅ Server 端口: 4096

## 下一步

- 查看 [项目文档入口 - docs/project.md](./docs/project.md) 了解更多
- 查看 [核心概念详解 - docs/agent-core-concepts.md](./docs/agent-core-concepts.md)
- 查看 [Environment 设计理念 - docs/environment-design-philosophy.md](./docs/environment-design-philosophy.md)
