# TUI 流式渲染架构设计文档

## 1. 架构概述

采用 OpenCode 成熟方案：后端累积 delta 发送全量内容，前端使用 SolidJS 响应式渲染实现无闪烁流式展示。

## 2. OpenCode 方案分析

### 2.1 数据流

```
LLM Stream
    ↓ (delta)
Backend (累积 delta → Part)
    ↓ (Event: PartUpdated { part: 全量, delta?: 增量 })
Frontend (SolidJS Store)
    ↓ (响应式更新)
UI (重新渲染，但只更新 DOM 文本节点)
```

### 2.2 核心设计原则

1. **全量存储**：始终传递完整的 Part 对象，不依赖 delta
2. **细粒度更新**：SolidJS 自动追踪依赖，只更新变化的 DOM
3. **增量可选**：delta 仅用于调试/日志，不参与渲染逻辑

## 3. 后端设计

### 3.1 Part 结构

```typescript
interface MessagePart {
  id: string;
  messageId: string;
  sessionId: string;
  type: "text" | "reasoning" | "tool";
  
  // Text/Reasoning 内容
  text?: string;  // 累积的完整内容
  
  // 工具调用
  tool?: string;
  state?: {
    status: "pending" | "completed" | "error";
    input?: Record<string, unknown>;
    output?: unknown;
  };
  
  time: {
    start: number;
    end?: number;
  };
}
```

### 3.2 事件定义

```typescript
interface PartUpdatedEvent {
  type: "message.part.updated";
  properties: {
    part: MessagePart;     // 完整的 Part（包含累积后的 text）
    delta?: string;        // 可选：本次更新的增量（用于日志）
  };
}
```

### 3.3 累积逻辑

```typescript
class StreamProcessor {
  private parts: Map<string, MessagePart> = new Map();
  
  handleDelta(type: "text" | "reasoning", delta: string, partId: string) {
    let part = this.parts.get(partId);
    
    if (!part) {
      // 创建新 Part
      part = {
        id: partId,
        type,
        text: "",
        time: { start: Date.now() }
      };
      this.parts.set(partId, part);
    }
    
    // 累积 delta
    part.text += delta;
    
    // 发送事件（传递完整 part）
    this.emitEvent("message.part.updated", {
      part: { ...part },  // 克隆避免引用问题
      delta
    });
  }
  
  completePart(partId: string) {
    const part = this.parts.get(partId);
    if (part) {
      part.time.end = Date.now();
      this.emitEvent("message.part.completed", { part });
    }
  }
}
```

### 3.4 SSE 事件格式

```json
{
  "type": "message.part.updated",
  "properties": {
    "part": {
      "id": "part_123",
      "messageId": "msg_456",
      "type": "text",
      "text": "Hello world! How are you?",
      "time": { "start": 1234567890 }
    },
    "delta": "you?"
  }
}
```

## 4. 前端设计

### 4.1 技术栈

- **框架**：SolidJS（细粒度响应式）
- **渲染引擎**：@opentui/solid（或自建类似实现）
- **状态管理**：SolidJS Store

### 4.2 Store 设计

```typescript
import { createStore } from "solid-js/store";

interface SessionStore {
  messages: Message[];
  parts: Record<string, MessagePart[]>;  // messageId -> parts
}

const [store, setStore] = createStore<SessionStore>({
  messages: [],
  parts: {}
});

// 事件处理
function handlePartUpdated(event: PartUpdatedEvent) {
  const { part } = event.properties;
  const { messageId } = part;
  
  setStore("parts", messageId, (parts = []) => {
    const index = parts.findIndex(p => p.id === part.id);
    if (index >= 0) {
      // 更新现有 part（SolidJS 自动追踪变化）
      return parts.map((p, i) => i === index ? part : p);
    } else {
      // 新增 part
      return [...parts, part];
    }
  });
}
```

### 4.3 组件设计

```tsx
// MessageList.tsx
function MessageList(props: { messageId: string }) {
  const parts = () => store.parts[props.messageId] || [];
  
  return (
    <For each={parts()}>
      {(part) => (
        <Switch>
          <Match when={part.type === "reasoning"}>
            <ReasoningPart part={part} />
          </Match>
          <Match when={part.type === "text"}>
            <TextPart part={part} />
          </Match>
          <Match when={part.type === "tool"}>
            <ToolPart part={part} />
          </Match>
        </Switch>
      )}
    </For>
  );
}

// TextPart.tsx - 关键：直接使用 part.text
function TextPart(props: { part: TextPart }) {
  return (
    <box paddingLeft={3}>
      <text>{props.part.text}</text>  {/* SolidJS 只更新文本节点 */}
    </box>
  );
}

// ReasoningPart.tsx
function ReasoningPart(props: { part: ReasoningPart }) {
  return (
    <box 
      paddingLeft={2} 
      border={["left"]}
      borderColor="gray"
    >
      <text dim italic color="gray">
        Thinking: {props.part.text}
      </text>
    </box>
  );
}
```

### 4.4 渲染优化

```typescript
// 使用 memo 避免不必要的重新计算
const messageContent = createMemo(() => {
  return props.parts.map(p => p.text).join("");
});

// SolidJS 自动优化：
// 1. 当 part.text 变化时，只更新对应的 <text> 节点
// 2. 不会重新渲染整个 MessageList
// 3. 不会清除和重绘屏幕
```

## 5. 不使用 SolidJS 的替代方案

如果无法使用 SolidJS，可以实现简化版本：

### 5.1 方案 A：行级增量更新（推荐）

```typescript
class SimpleRenderer {
  private renderedLines: Map<string, number> = new Map();
  
  updatePart(part: MessagePart) {
    const partId = part.id;
    const lines = this.wrapText(part.text || "", width);
    const prevLineCount = this.renderedLines.get(partId) || 0;
    
    if (lines.length > prevLineCount) {
      // 有新行，追加渲染
      for (let i = prevLineCount; i < lines.length; i++) {
        this.appendLine(lines[i]);
      }
      this.renderedLines.set(partId, lines.length);
    } else if (lines.length === prevLineCount && lines.length > 0) {
      // 最后一行内容更新，回到行首重新渲染
      this.moveToLineStart();
      this.renderLine(lines[lines.length - 1]);
    }
  }
}
```

### 5.2 方案 B：全量重绘（简单但可能闪烁）

```typescript
// 每次清除并重新渲染整个消息区域
renderMessage(parts: MessagePart[]) {
  this.clearMessageArea();
  for (const part of parts) {
    this.renderPart(part);
  }
}
```

## 6. 实现步骤

### Phase 1: 后端改造
1. 修改事件结构，发送完整 Part 对象
2. 实现 delta 累积逻辑
3. 更新 SSE 事件格式

### Phase 2: 前端 Store
1. 引入 SolidJS（或自建响应式系统）
2. 实现 Store 和事件处理
3. 替换现有渲染逻辑

### Phase 3: 组件迁移
1. 创建 Part 组件（TextPart, ReasoningPart, ToolPart）
2. 使用 SolidJS 响应式绑定
3. 测试流式渲染性能

### Phase 4: 优化
1. 添加虚拟滚动（消息过多时）
2. 优化首屏渲染
3. 添加动画效果

## 7. 关键决策

| 决策点 | 方案 | 原因 |
|--------|------|------|
| 状态管理 | SolidJS Store | 细粒度响应式，自动优化 |
| 渲染引擎 | @opentui/solid | OpenCode 验证，支持流式 |
| 事件格式 | 全量 Part + 可选 delta | 简化前端逻辑，便于调试 |
| 累积逻辑 | 后端累积 | 前端无状态，可安全重连 |
| 更新策略 | 响应式自动更新 | 无需手动 diff，代码简洁 |

## 8. 与当前实现对比

### 当前问题
- 手动跟踪增量，逻辑复杂
- 清屏重绘导致闪烁
- delta 和 content 混用

### OpenCode 优势
- 全量更新，逻辑简单
- SolidJS 自动优化，无闪烁
- 响应式编程，代码简洁

## 9. 参考实现

### OpenCode 关键文件
- `packages/opencode/src/session/processor.ts` - 后端累积逻辑
- `packages/opencode/src/session/index.ts` - Part 更新 API
- `packages/opencode/src/cli/cmd/tui/context/sync.tsx` - 前端 Store
- `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx` - 组件渲染

---

**文档版本**: 1.0  
**创建日期**: 2026-02-08  
**参考**: OpenCode TUI 深度解析
