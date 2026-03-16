import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { wrapFunction, Traced } from "./wrap-function.js";
import { SpanCollector, setSpanCollector, InMemorySpanStorage } from "./span-index.js";
import { existsSync, readFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("wrapFunction with caller location", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `wrap-function-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should log with original function location, not wrap-function.ts", async () => {
    // 需要动态导入以设置 log directory override
    const { setLogDirOverride, Logger } = await import("./logger.js");
    setLogDirOverride(tempDir);
    Logger.setGlobalLevel("debug");

    const { wrapFunction: wf } = await import("./wrap-function.js");
    const { setSpanCollector, SpanCollector, InMemorySpanStorage } = await import("./span-index.js");

    const storage = new InMemorySpanStorage();
    const collector = new SpanCollector(storage);
    setSpanCollector(collector as any);

    // 创建一个在本文件中定义的函数，用于验证日志位置
    function myTestFunction(x: number): number {
      return x * 2;
    }

    // 用 wrapFunction 包装，启用日志
    const wrappedFn = wf(myTestFunction, "my.test.func", { log: true });

    // 调用函数
    wrappedFn(42);

    // 检查日志文件
    const logFile = join(tempDir, "server.log");
    const content = readFileSync(logFile, "utf-8");

    // 验证日志包含原函数位置（wrap-function.test.ts），而不是 wrap-function.ts
    expect(content).toContain("[traced:my.test.func]");
    expect(content).toContain(">>> my.test.func enter");
    // 应该包含测试文件的位置
    expect(content).toContain("wrap-function.test.ts");
    // 不应该包含 wrap-function.ts 作为调用位置
    const lines = content.split("\n").filter(l => l.includes("my.test.func"));
    for (const line of lines) {
      // 排除 logger.ts 本身的位置显示
      if (line.includes("[") && !line.includes("logger.ts")) {
        expect(line).not.toMatch(/wrap-function\.ts:\d+/);
      }
    }

    setSpanCollector(null as any);
    setLogDirOverride(null as any);
    Logger.setGlobalLevel(null);
  });

  it("should log return value in quit log when recordResult is true", async () => {
    const { setLogDirOverride, Logger } = await import("./logger.js");
    setLogDirOverride(tempDir);
    Logger.setGlobalLevel("debug");

    const { wrapFunction: wf } = await import("./wrap-function.js");
    const { setSpanCollector, SpanCollector, InMemorySpanStorage } = await import("./span-index.js");

    const storage = new InMemorySpanStorage();
    const collector = new SpanCollector(storage);
    setSpanCollector(collector as any);

    function addFunction(a: number, b: number): number {
      return a + b;
    }

    // 用 wrapFunction 包装，启用日志和记录返回值
    const wrappedFn = wf(addFunction, "add.func", { log: true, recordResult: true });

    // 调用函数
    const result = wrappedFn(2, 3);
    expect(result).toBe(5);

    // 检查日志文件
    const logFile = join(tempDir, "server.log");
    const content = readFileSync(logFile, "utf-8");

    // 验证 quit 日志包含返回值
    expect(content).toContain("<<< add.func quit");
    expect(content).toContain("5");

    setSpanCollector(null as any);
    setLogDirOverride(null as any);
    Logger.setGlobalLevel(null);
  });

  it("should NOT log return value in quit log when recordResult is false", async () => {
    const { setLogDirOverride, Logger } = await import("./logger.js");
    setLogDirOverride(tempDir);
    Logger.setGlobalLevel("debug");

    const { wrapFunction: wf } = await import("./wrap-function.js");
    const { setSpanCollector, SpanCollector, InMemorySpanStorage } = await import("./span-index.js");

    const storage = new InMemorySpanStorage();
    const collector = new SpanCollector(storage);
    setSpanCollector(collector as any);

    function multiplyFunction(a: number, b: number): number {
      return a * b;
    }

    // 用 wrapFunction 包装，启用日志但不记录返回值
    const wrappedFn = wf(multiplyFunction, "multiply.func", { log: true, recordResult: false });

    // 调用函数
    const result = wrappedFn(3, 4);
    expect(result).toBe(12);

    // 检查日志文件
    const logFile = join(tempDir, "server.log");
    const content = readFileSync(logFile, "utf-8");

    // 验证 quit 日志不包含返回值
    expect(content).toContain("<<< multiply.func quit");
    // quit 后面不应该有数字返回值
    const quitLines = content.split("\n").filter(l => l.includes("<<< multiply.func quit"));
    for (const line of quitLines) {
      expect(line).not.toMatch(/quit:\s*\d+/);
    }

    setSpanCollector(null as any);
    setLogDirOverride(null as any);
    Logger.setGlobalLevel(null);
  });
});

describe("wrapFunction with paramFilter", () => {
  let collector: SpanCollector;

  beforeEach(() => {
    const storage = new InMemorySpanStorage();
    collector = new SpanCollector(storage);
    setSpanCollector(collector as any);
  });

  afterEach(() => {
    setSpanCollector(null as any);
  });

  it("should filter params using paramFilter", () => {
    const fn = wrapFunction(
      (a: number, b: number, c: number) => a + b + c,
      "add",
      {
        recordParams: true,
        paramFilter: (args) => ({ a: args[0] }),
      }
    );

    fn(1, 2, 3);

    const traces = collector.listTraces(10);
    expect(traces.length).toBe(1);
    
    const spans = collector.getTrace(traces[0].traceId);
    const addSpan = spans.find(s => s.name === "add");
    expect(addSpan).toBeDefined();
    expect((addSpan!.attributes as any).params).toEqual({ a: 1 });
  });

  it("should record all params when paramFilter is not provided", () => {
    const fn = wrapFunction(
      (a: number, b: number, c: number) => a + b + c,
      "add_all",
      {
        recordParams: true,
      }
    );

    fn(1, 2, 3);

    const traces = collector.listTraces(10);
    const spans = collector.getTrace(traces[0].traceId);
    const addSpan = spans.find(s => s.name === "add_all");
    expect(addSpan).toBeDefined();
    expect((addSpan!.attributes as any).params).toEqual([1, 2, 3]);
  });

  it("should return empty object when paramFilter returns empty", () => {
    const fn = wrapFunction(
      (a: number, b: number) => a + b,
      "empty_filter",
      {
        recordParams: true,
        paramFilter: () => ({}),
      }
    );

    fn(1, 2);

    const traces = collector.listTraces(10);
    const spans = collector.getTrace(traces[0].traceId);
    const span = spans.find(s => s.name === "empty_filter");
    expect(span).toBeDefined();
    expect((span!.attributes as any).params).toEqual({});
  });

  it("should transform params in paramFilter", () => {
    const fn = wrapFunction(
      (name: string, age: number) => ({ name, age }),
      "person",
      {
        recordParams: true,
        paramFilter: (args) => ({ 
          nameLength: (args[0] as string).length,
          age: args[1] 
        }),
      }
    );

    fn("Alice", 30);

    const traces = collector.listTraces(10);
    const spans = collector.getTrace(traces[0].traceId);
    const personSpan = spans.find(s => s.name === "person");
    expect(personSpan).toBeDefined();
    expect((personSpan!.attributes as any).params).toEqual({ nameLength: 5, age: 30 });
  });
});

describe("Traced decorator with paramFilter", () => {
  let collector: SpanCollector;

  beforeEach(() => {
    const storage = new InMemorySpanStorage();
    collector = new SpanCollector(storage);
    setSpanCollector(collector as any);
  });

  afterEach(() => {
    setSpanCollector(null as any);
  });

  it("should use paramFilter from decorator options", () => {
    class TestClass {
      @Traced({
        name: "test.method",
        recordParams: true,
        paramFilter: (args) => ({ first: args[0] })
      })
      async method(a: string, b: string, c: string): Promise<string> {
        return a + b + c;
      }
    }

    const instance = new TestClass();
    instance.method("hello", "world", "test");

    const traces = collector.listTraces(10);
    const spans = collector.getTrace(traces[0].traceId);
    const methodSpan = spans.find(s => s.name === "test.method");
    expect(methodSpan).toBeDefined();
    expect((methodSpan!.attributes as any).params).toEqual({ first: "hello" });
  });
});
