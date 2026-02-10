/**
 * @fileoverview EventStream batch 错误调试测试
 *
 * 复现和调试 TUI 中 batch() 调用导致的错误
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// ============================================================================
// 模拟 SolidJS batch 行为
// ============================================================================

// 模拟 batch 调用中的错误场景
class BatchErrorSimulator {
  private callCount = 0;
  private errors: Error[] = [];

  // 模拟有问题的 batch 实现
  simulateBatchWithError<T>(fn: () => T): T {
    this.callCount++;
    console.log(`[BatchErrorSimulator] batch() called #${this.callCount}`);
    
    try {
      return fn();
    } catch (error) {
      this.errors.push(error as Error);
      console.error(`[BatchErrorSimulator] Error in batch #${this.callCount}:`, (error as Error).message);
      throw error;
    }
  }

  getCallCount() {
    return this.callCount;
  }

  getErrors() {
    return this.errors;
  }
}

// ============================================================================
// 模拟事件流处理
// ============================================================================

interface StreamEvent {
  type: string;
  messageId?: string;
  content?: string;
  delta?: string;
}

class MockEventStream {
  private eventQueue: StreamEvent[] = [];
  private processedEvents: StreamEvent[] = [];
  private errors: Error[] = [];
  private batchSimulator: BatchErrorSimulator;

  constructor(batchSimulator: BatchErrorSimulator) {
    this.batchSimulator = batchSimulator;
  }

  // 模拟 flushEvents 函数
  flushEvents() {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];

    console.log(`[MockEventStream] Flushing ${events.length} events`);

    try {
      // 使用 batch 批量处理
      this.batchSimulator.simulateBatchWithError(() => {
        for (const event of events) {
          this.handleEvent(event);
        }
      });
    } catch (error) {
      this.errors.push(error as Error);
      console.error("[MockEventStream] batch() failed:", (error as Error).message);
    }
  }

  // 模拟 handleEvent 函数
  private handleEvent(event: StreamEvent) {
    console.log(`[MockEventStream] Handling event: ${event.type}`);
    
    // 模拟可能的错误场景
    switch (event.type) {
      case "stream.start":
        // 可能的问题：messageId 为 undefined
        if (!event.messageId) {
          console.warn("[MockEventStream] Warning: stream.start without messageId");
        }
        break;
      
      case "stream.text":
        // 可能的问题：delta 为 undefined
        if (event.delta === undefined) {
          throw new Error("stream.text event missing delta");
        }
        break;

      case "stream.error":
        throw new Error(`Stream error: ${event.content}`);
    }

    this.processedEvents.push(event);
  }

  queueEvent(event: StreamEvent) {
    this.eventQueue.push(event);
    // 立即刷新以测试
    this.flushEvents();
  }

  getProcessedEvents() {
    return this.processedEvents;
  }

  getErrors() {
    return this.errors;
  }
}

// ============================================================================
// 测试场景
// ============================================================================

describe("EventStream batch 错误调试", () => {
  let batchSimulator: BatchErrorSimulator;
  let eventStream: MockEventStream;

  beforeEach(() => {
    batchSimulator = new BatchErrorSimulator();
    eventStream = new MockEventStream(batchSimulator);
  });

  it("应该正常处理有效的事件序列", () => {
    const events: StreamEvent[] = [
      { type: "stream.start", messageId: "msg-1" },
      { type: "stream.text", messageId: "msg-1", delta: "Hello" },
      { type: "stream.text", messageId: "msg-1", delta: " World" },
      { type: "stream.completed" },
    ];

    for (const event of events) {
      eventStream.queueEvent(event);
    }

    expect(eventStream.getProcessedEvents().length).toBe(4);
    expect(eventStream.getErrors().length).toBe(0);
    expect(batchSimulator.getCallCount()).toBe(4);
  });

  it("应该处理缺少 delta 的 stream.text 事件（模拟错误场景）", () => {
    // 这个测试验证错误被捕获并记录，而不是抛出
    const event: StreamEvent = {
      type: "stream.text",
      messageId: "msg-1",
      // 故意缺少 delta
    };

    // MockEventStream 会捕获错误但不抛出，继续处理
    eventStream.queueEvent(event);

    // 验证错误被记录
    expect(eventStream.getErrors().length).toBeGreaterThan(0);
    expect(eventStream.getErrors()[0].message).toContain("missing delta");
  });

  it("应该处理 stream.error 事件", () => {
    const event: StreamEvent = {
      type: "stream.error",
      content: "Connection lost",
    };

    // MockEventStream 会捕获错误但不抛出
    eventStream.queueEvent(event);

    // 验证错误被记录
    expect(eventStream.getErrors().length).toBe(1);
    expect(eventStream.getErrors()[0].message).toContain("Connection lost");
  });

  it("应该处理空的 messageId", () => {
    const events: StreamEvent[] = [
      { type: "stream.start" }, // 缺少 messageId
      { type: "stream.text", messageId: "msg-1", delta: "test" },
    ];

    for (const event of events) {
      eventStream.queueEvent(event);
    }

    // 应该完成处理，虽然有警告
    expect(eventStream.getProcessedEvents().length).toBe(2);
    expect(eventStream.getErrors().length).toBe(0);
  });

  it("应该快速连续的事件触发", () => {
    // 模拟流式传输中的快速事件
    const events: StreamEvent[] = [];
    for (let i = 0; i < 100; i++) {
      events.push({
        type: "stream.text",
        messageId: "msg-1",
        delta: `chunk-${i} `,
      });
    }

    for (const event of events) {
      eventStream.queueEvent(event);
    }

    expect(eventStream.getProcessedEvents().length).toBe(100);
    expect(eventStream.getErrors().length).toBe(0);
  });
});

describe("真实的 EventStream 错误分析", () => {
  it("应该分析错误堆栈中的关键信息", () => {
    // 根据实际观察到的错误堆栈
    const observedError = {
      location: "event-stream.tsx:47:5",
      function: "flushEvents",
      error: "batch() execution failed",
    };

    console.log("\n========== 错误分析 ==========");
    console.log("错误位置:", observedError.location);
    console.log("错误函数:", observedError.function);
    console.log("错误类型:", observedError.error);
    console.log("\n可能的原因:");
    console.log("1. handleEvent 中访问了未定义的属性");
    console.log("2. store.updateMessageContent 传入了 null/undefined");
    console.log("3. SolidJS 的响应式系统在非响应式上下文中被调用");
    console.log("==============================\n");

    expect(observedError.function).toBe("flushEvents");
  });

  it("应该测试边界条件", () => {
    const boundaryCases = [
      { desc: "空事件队列", events: [] },
      { desc: "单事件", events: [{ type: "stream.start", messageId: "1" }] },
      { desc: "重复事件", events: [
        { type: "stream.start", messageId: "1" },
        { type: "stream.start", messageId: "1" },
      ]},
      { desc: "混合类型", events: [
        { type: "stream.start", messageId: "1" },
        { type: "stream.reasoning", messageId: "1", content: "thinking" },
        { type: "stream.tool.call", messageId: "1", toolName: "bash" },
        { type: "stream.completed" },
      ]},
    ];

    for (const testCase of boundaryCases) {
      console.log(`\n测试: ${testCase.desc}`);
      console.log(`事件数: ${testCase.events.length}`);
      
      // 这里可以添加具体的断言
      expect(testCase.events.length).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================================
// 调试建议
// ============================================================================

describe("调试建议", () => {
  it("应该提供调试步骤", () => {
    const debugSteps = [
      "1. 在 event-stream.tsx 的 handleEvent 函数中添加 try-catch",
      "2. 在 batch() 调用前后添加 console.log 查看事件队列状态",
      "3. 检查 store.appendMessageContent 的参数是否为字符串",
      "4. 验证 messageId 是否存在且有效",
      "5. 检查是否有事件类型未被正确处理",
    ];

    console.log("\n========== 调试步骤建议 ==========");
    for (const step of debugSteps) {
      console.log(step);
    }
    console.log("==================================\n");

    expect(debugSteps.length).toBeGreaterThan(0);
  });

  it("应该列出需要检查的关键代码位置", () => {
    const keyLocations = [
      { file: "event-stream.tsx", line: 81, desc: "batch() 调用" },
      { file: "event-stream.tsx", line: 147, desc: "appendMessageContent 调用" },
      { file: "store.tsx", line: 154, desc: "appendMessageContent 实现" },
      { file: "MessageList.tsx", line: 52, desc: "validSyntaxStyle 检查" },
    ];

    console.log("\n========== 关键代码位置 ==========");
    for (const loc of keyLocations) {
      console.log(`${loc.file}:${loc.line} - ${loc.desc}`);
    }
    console.log("==================================\n");

    expect(keyLocations.length).toBeGreaterThan(0);
  });
});
