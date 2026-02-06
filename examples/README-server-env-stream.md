# ServerEnvironment Stream Demo

## 功能

演示 ServerEnvironment 的流式事件输出能力，使用 EventBus 实时接收并显示 LLM 响应。

## 特点

- ✅ 使用 ServerEnvironment (带 EventBus 集成)
- ✅ 实时显示 LLM 流式响应
- ✅ 显示工具调用和结果
- ✅ 显示推理过程 (支持推理的模型如 Kimi)
- ✅ 支持交互模式和单次查询模式

## 使用方法

### 1. 配置环境变量

创建 `.env` 文件：

```bash
LLM_MODEL=openai/gpt-4o-mini
LLM_API_KEY=your-api-key-here
LLM_BASE_URL=https://api.openai.com/v1  # 可选
```

### 2. 运行示例

**交互模式：**
```bash
bun run examples/server-env-stream-demo.ts
```

**单次查询模式：**
```bash
echo "解释什么是EventBus" | bun run examples/server-env-stream-demo.ts
```

### 3. 观察输出

示例会显示：
- 🚀 [开始] - 流式响应开始
- 🤖 - 实时文本输出（逐字显示）
- 💭 [推理] - 推理过程（如果模型支持）
- 🔧 [工具调用] - 工具调用信息
- 📋 [工具结果] - 工具执行结果
- ✅ [完成] - 完成信息 + Token 使用统计

## 架构说明

```
用户输入
    ↓
ServerEnvironment
    ↓ (触发 stream 事件)
onStreamEvent hook
    ↓ (发布到)
EventBus
    ↓ (订阅)
示例中的事件处理器
    ↓ (实时显示)
终端输出
```

## 关键代码

订阅流式事件：
```typescript
Bus.subscribe(StreamTextEvent, (event) => {
  process.stdout.write(event.properties.delta);
}, sessionId);
```

处理查询：
```typescript
await env.handle_query(query, { session_id: sessionId }, history);
```

## 参考

- [EventBus 设计文档](../docs/architecture/eventbus-design.md)
- [Server 设计文档](../docs/app/server-design.md)
