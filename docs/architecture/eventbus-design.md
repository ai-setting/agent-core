# EventBus 设计文档

## 1. 概述

EventBus 是基于 OpenCode 架构实现的事件总线系统，用于在 Server 内部模块间进行解耦通信，并将事件广播到 SSE 客户端。

**核心特点**:
- 类型安全：使用 Zod 定义事件 Schema
- 实例隔离：支持多 Session 实例
- 全局广播：通过 GlobalBus 跨实例通信
- 订阅模式：支持精确订阅和通配符订阅

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        EventBus System                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐      ┌──────────────────┐                 │
│  │   GlobalBus      │      │   Session Bus    │                 │
│  │   (EventEmitter) │◄────►│   (per session)  │                 │
│  │                  │      │                  │                 │
│  │  • cross-session │      │  • subscriptions │                 │
│  │    broadcast     │      │    Map          │                 │
│  └──────────────────┘      └──────────────────┘                 │
│           │                           │                          │
│  ┌────────▼──────────┐     ┌──────────▼─────────┐               │
│  │   SSE Clients     │     │   Internal Modules │               │
│  │   (all sessions)  │     │   (this session)   │               │
│  └───────────────────┘     └────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

#### BusEvent - 事件定义
使用 Zod 定义强类型事件

#### Bus - 事件总线
提供 publish, subscribe, subscribeAll, once 方法

#### GlobalBus - 全局广播
跨实例通信

## 3. 事件类型

### 流式事件
- `stream.start` - 开始流式响应
- `stream.text` - 文本片段
- `stream.reasoning` - 推理过程
- `stream.tool.call` - 工具调用
- `stream.tool.result` - 工具结果
- `stream.completed` - 完成
- `stream.error` - 错误

### Session 事件
- `session.created` - 会话创建
- `session.updated` - 会话更新
- `session.deleted` - 会话删除

## 4. 实现要点

### 4.1 类型安全
所有事件使用 Zod Schema 定义，确保类型安全

### 4.2 异步发布
publish 方法返回 Promise，等待所有订阅者处理完成

### 4.3 订阅管理
subscribe 返回取消订阅函数

### 4.4 日志记录
所有发布和订阅操作都记录日志

## 5. 使用示例

```typescript
// 定义事件
const MyEvent = BusEvent.define("my.event", z.object({ id: z.string() }))

// 发布事件
await Bus.publish(MyEvent, { id: "123" })

// 订阅事件
const unsubscribe = Bus.subscribe(MyEvent, (event) => {
  console.log(event.properties.id)
})

// 取消订阅
unsubscribe()
```

## 6. 参考

基于 OpenCode 的 Bus 实现
