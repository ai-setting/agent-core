# Agent-Core ESC 中断功能设计文档

## 1. 需求概述

TUI 界面按 ESC 键可以中断当前正在运行的 LLM 流式输出。

## 2. 现有架构分析

agent-core 已具备基础能力：
- `Context.abort?: AbortSignal` - 已在 `core/types/context.ts:9` 定义
- `invoke_llm` 已使用 `signal: ctx.abort` - 已在 `invoke-llm.ts:187` 实现
- `Agent.run()` 循环检查 `this.context.abort?.aborted` - 已在 `agent/index.ts:126` 实现

**缺失部分**：
1. 没有 SessionAbortManager 管理 AbortController
2. handle_query 没有传入 abort signal
3. 没有 interrupt route
4. invoke_llm 流式读取没有 catch AbortError

## 3. 最小化实现方案

### 3.1 新增 SessionAbortManager

位置：`packages/core/src/core/session/abort-manager.ts`（新增文件）

```typescript
export class SessionAbortManager {
  private controllers = new Map<string, AbortController>();

  create(sessionId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    return controller;
  }

  abort(sessionId: string): void {
    const controller = this.controllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.controllers.delete(sessionId);
    }
  }

  get(sessionId: string): AbortSignal | undefined {
    return this.controllers.get(sessionId)?.signal;
  }

  has(sessionId: string): boolean {
    return this.controllers.has(sessionId);
  }
}

export const sessionAbortManager = new SessionAbortManager();
```

### 3.2 修改 handle_query 传入 abort signal

位置：`packages/core/src/core/environment/base/base-environment.ts`

```typescript
async handle_query(query: string, context?: Context, history?: HistoryMessage[]): Promise<string> {
  // 如果有 session_id，创建或获取 abort controller
  const sessionId = context?.session_id;
  let abortSignal: AbortSignal | undefined;
  
  if (sessionId) {
    if (!sessionAbortManager.has(sessionId)) {
      sessionAbortManager.create(sessionId);
    }
    abortSignal = sessionAbortManager.get(sessionId);
  }

  const agentContext = {
    ...context,
    message_id: messageId,
    abort: abortSignal,  // 传入 abort signal
  };
  // ...
}
```

### 3.3 新增 interrupt route

位置：`packages/core/src/server/routes/sessions.ts`

```typescript
/**
 * POST /sessions/:id/interrupt - Interrupt a running session
 */
app.post("/:id/interrupt", async (c) => {
  const env = await ensureSessionEnv(c);
  if (!env) return c.json({ error: "Session support not available" }, 503);

  const id = c.req.param("id");
  
  if (sessionAbortManager.has(id)) {
    sessionAbortManager.abort(id);
    sessionLogger.info("Session interrupted", { sessionId: id });
    return c.json({ success: true, interrupted: true });
  }
  
  return c.json({ success: true, interrupted: false });
});
```

### 3.4 TUI 端 ESC 处理

位置：`packages/core/src/cli/tui/components/InputBox.tsx`

- 5 秒内按 2 次 ESC 才触发中断（防止误触）
- 调用 `sdk.session.interrupt()` 
- 不等待返回，不退出 TUI

```typescript
// ESC 键处理
if (e.key === "Escape") {
  const now = Date.now();
  if (now - lastEscPress < 5000) {
    // 第二次按 ESC，触发 abort
    sdk.session.interrupt({ sessionId: currentSessionId });
  }
  lastEscPress = now;
}
```

### 3.5 SDK 端新增 interrupt 方法

位置：参考现有的 SDK session 方法

```typescript
// session.interrupt() -> POST /sessions/:id/interrupt
```

## 4. invoke_llm 流式中断处理（重要）

位置：`packages/core/src/core/environment/base/invoke-llm.ts`

流式读取时需要 catch AbortError，让流优雅退出：

```typescript
while (true) {
  try {
    const { done, value } = await reader.read();
    if (done) break;
    // ... 处理 chunk
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // 优雅退出，不算 error
      break;
    }
    throw err;
  }
}
```

## 5. 实现清单

| 步骤 | 文件 | 修改内容 |
|------|------|----------|
| 1 | `core/session/abort-manager.ts` | 新增 SessionAbortManager 类 |
| 2 | `core/environment/base/invoke-llm.ts` | 流式读取 catch AbortError |
| 3 | `core/environment/base/base-environment.ts` | handle_query 传入 abort signal |
| 4 | `server/routes/sessions.ts` | 新增 POST /:id/interrupt 路由 |
| 5 | SDK | 新增 session.interrupt() 方法 |
| 6 | `cli/tui/components/InputBox.tsx` | ESC 键监听，调用 interrupt |

## 6. 确认的问题

- [x] 双按 ESC 间隔 5 秒
- [x] 中断后不退出 TUI，不撤销消息
- [x] Sub-agent 暂不处理
