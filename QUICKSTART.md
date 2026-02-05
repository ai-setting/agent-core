# Agent Core - Quick Start

## 最小可用集 (MVP)

Agent Core 是一个轻量级 AI Agent 框架，支持工具调用、错误恢复和流式事件。

## 核心特性

- **工具调用**: 注册和执行自定义工具
- **LLM 集成**: 支持 OpenAI 格式的适配器
- **错误恢复**: 重试、降级、超时控制
- **并发管理**: 限制并发执行数量
- **流式事件**: 通过 hook 机制广播事件

## 安装

```bash
npm install
```

## 基础用法

### 1. 创建环境

最小集合只包含 `invoke_llm` 和 `system1_intuitive_reasoning` 两个 LLM 工具。

```typescript
import { BaseEnvironment, createInvokeLLM } from "./src/environment/index.js";

class MyEnv extends BaseEnvironment {
  protected getDefaultTimeout(toolName: string): number {
    return 30000;
  }

  protected getTimeoutOverride(action: Action): number | undefined {
    return undefined;
  }

  protected getMaxRetries(toolName: string): number {
    return 3;
  }

  protected getRetryDelay(toolName: string): number {
    return 1000;
  }

  protected isRetryableError(error: string): boolean {
    return error.includes("timeout") || error.includes("network");
  }

  protected getConcurrencyLimit(toolName: string): number {
    return 5;
  }

  protected getRecoveryStrategy(toolName: string) {
    return { type: "retry", maxRetries: 3 };
  }
}

const env = new MyEnv();
```

### 2. 配置 LLM 适配器

```typescript
import { OpenAIAdapter } from "./src/llm/adapters/openai.js";

const adapter = new OpenAIAdapter({
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-4",
});

env.configureLLM(adapter, "gpt-4");
```

### 3. 处理查询

```typescript
const context: Context = {
  session_id: "session-001",
  workdir: "/tmp",
  user_id: "user-001",
  abort: undefined,
  metadata: {},
};

const response = await env.handle_query("你好，请介绍一下你自己", context);
console.log(response);
```

## 扩展：注册 OS 工具

OS 工具（bash, read_file, write_file, glob, grep）需要在扩展 env 中单独注册：

```typescript
import { createBashTool, createFileTools } from "./src/index.js";

env.registerTool(createBashTool());
env.registerTool(...createFileTools());
```

或者使用 `OsEnv` 作为基类：

```typescript
import { OsEnv } from "./src/index.js";

class MyOsEnv extends OsEnv {
  // 继承所有 OS 工具
}

const env = new MyOsEnv();
env.configureLLM(adapter, "gpt-4");
```

## 错误处理

框架内置以下错误恢复机制：

- **超时控制**: 可配置全局/工具级超时
- **重试机制**: 指数退避重试临时错误
- **Doom Loop 检测**: 防止相同工具无限循环调用
- **并发限制**: 防止资源耗尽

## 流式事件 (可选)

通过 `onStreamEvent` hook 监听事件：

```typescript
env.onStreamEvent = async (event, context) => {
  console.log(`[${event.type}]`, event);
};

// 事件类型: start, text, reasoning, tool_call, tool_result, completed, error
```

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

- ✅ 249 个测试全部通过
- ✅ TypeScript 类型检查通过
- ✅ 测试覆盖率: 84.89% 函数, 89.76% 行

## 下一步

- 实现 SSE/WebSocket 实时事件广播
- 添加会话持久化
- 集成到实际应用
