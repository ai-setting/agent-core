import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { wrapFunction, Traced } from "./wrap-function.js";
import { SpanCollector, setSpanCollector, InMemorySpanStorage } from "./span-index.js";

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
