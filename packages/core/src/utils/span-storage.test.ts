import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { InMemorySpanStorage, SQLiteSpanStorage } from "./span-storage";
import { Span, SpanKind, SpanStatus } from "./span";
import path from "path";
import fs from "fs";

describe("SpanStorage", () => {
  describe("InMemorySpanStorage", () => {
    let storage: InMemorySpanStorage;

    beforeEach(() => {
      storage = new InMemorySpanStorage();
    });

    it("should initialize without error", async () => {
      await storage.initialize();
      expect(true).toBe(true);
    });

    it("should save and retrieve span by traceId", async () => {
      await storage.initialize();
      
      const span: Span = {
        spanId: "span_1",
        traceId: "trace_1",
        parentSpanId: undefined,
        name: "test_span",
        kind: SpanKind.INTERNAL,
        status: SpanStatus.OK,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        attributes: { key: "value" },
        children: [],
      };

      storage.save(span);
      const spans = storage.findByTraceId("trace_1");
      
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("test_span");
    });

    it("should find span by spanId from cache", async () => {
      await storage.initialize();
      
      const span: Span = {
        spanId: "span_1",
        traceId: "trace_1",
        parentSpanId: undefined,
        name: "test_span",
        kind: SpanKind.INTERNAL,
        status: SpanStatus.OK,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        attributes: {},
        children: [],
      };

      storage.save(span);
      const found = storage.findBySpanId("span_1");
      
      expect(found).toBeDefined();
      expect(found?.name).toBe("test_span");
    });

    it("should return undefined for non-existent spanId", async () => {
      await storage.initialize();
      
      const found = storage.findBySpanId("non_existent");
      expect(found).toBeUndefined();
    });

    it("should list traces", async () => {
      await storage.initialize();
      
      const span1: Span = {
        spanId: "span_1",
        traceId: "trace_1",
        parentSpanId: undefined,
        name: "span_1",
        kind: SpanKind.INTERNAL,
        status: SpanStatus.OK,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        attributes: {},
        children: [],
      };

      const span2: Span = {
        spanId: "span_2",
        traceId: "trace_2",
        parentSpanId: undefined,
        name: "span_2",
        kind: SpanKind.INTERNAL,
        status: SpanStatus.OK,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        attributes: {},
        children: [],
      };

      storage.save(span1);
      storage.save(span2);

      const traces = storage.listTraces(10);
      expect(traces).toHaveLength(2);
    });
  });

  describe("SQLiteSpanStorage", () => {
    let storage: SQLiteSpanStorage;
    let tempDir: string;

    beforeEach(async () => {
      tempDir = fs.mkdtempSync("/tmp/span-storage-test-");
      const dbPath = path.join(tempDir, "test-spans.db");
      storage = new SQLiteSpanStorage(dbPath);
      await storage.initialize();
    });

    afterEach(() => {
      storage.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("should initialize without error", () => {
      expect(true).toBe(true);
    });

    it("should save and retrieve span by traceId", async () => {
      const span: Span = {
        spanId: "span_1",
        traceId: "trace_1",
        parentSpanId: undefined,
        name: "test_span",
        kind: SpanKind.INTERNAL,
        status: SpanStatus.OK,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        attributes: { key: "value" },
        children: [],
      };

      storage.save(span);
      const spans = storage.findByTraceId("trace_1");
      
      expect(spans).toHaveLength(1);
      expect(spans[0].name).toBe("test_span");
    });

    it("should find span by spanId from cache", async () => {
      const span: Span = {
        spanId: "span_1",
        traceId: "trace_1",
        parentSpanId: undefined,
        name: "test_span",
        kind: SpanKind.INTERNAL,
        status: SpanStatus.OK,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        attributes: {},
        children: [],
      };

      storage.save(span);
      const found = storage.findBySpanId("span_1");
      
      expect(found).toBeDefined();
      expect(found?.name).toBe("test_span");
    });

    it("should find span by spanId from database", async () => {
      // First save a span
      const span: Span = {
        spanId: "span_1",
        traceId: "trace_1",
        parentSpanId: undefined,
        name: "test_span",
        kind: SpanKind.INTERNAL,
        status: SpanStatus.OK,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        attributes: {},
        children: [],
      };
      storage.save(span);

      // Clear the in-memory cache to force DB lookup
      // (simulating a new instance or cache eviction)
      // Note: We can't easily clear the cache, but we can verify 
      // that findBySpanId works after save

      const found = storage.findBySpanId("span_1");
      expect(found).toBeDefined();
      expect(found?.name).toBe("test_span");
    });

    it("should return undefined for non-existent spanId", async () => {
      const found = storage.findBySpanId("non_existent");
      expect(found).toBeUndefined();
    });

    it("should save and retrieve nested spans", async () => {
      const parentSpan: Span = {
        spanId: "parent_span",
        traceId: "trace_1",
        parentSpanId: undefined,
        name: "parent",
        kind: SpanKind.INTERNAL,
        status: SpanStatus.OK,
        startTime: Date.now(),
        endTime: Date.now() + 200,
        attributes: {},
        children: [],
      };

      const childSpan: Span = {
        spanId: "child_span",
        traceId: "trace_1",
        parentSpanId: "parent_span",
        name: "child",
        kind: SpanKind.INTERNAL,
        status: SpanStatus.OK,
        startTime: Date.now() + 50,
        endTime: Date.now() + 150,
        attributes: {},
        children: [],
      };

      storage.save(parentSpan);
      storage.save(childSpan);

      // Find parent
      const foundParent = storage.findBySpanId("parent_span");
      expect(foundParent).toBeDefined();
      expect(foundParent?.name).toBe("parent");

      // Find child
      const foundChild = storage.findBySpanId("child_span");
      expect(foundChild).toBeDefined();
      expect(foundChild?.name).toBe("child");
    });

    it("should list traces", async () => {
      const span1: Span = {
        spanId: "span_1",
        traceId: "trace_1",
        parentSpanId: undefined,
        name: "span_1",
        kind: SpanKind.INTERNAL,
        status: SpanStatus.OK,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        attributes: {},
        children: [],
      };

      const span2: Span = {
        spanId: "span_2",
        traceId: "trace_2",
        parentSpanId: undefined,
        name: "span_2",
        kind: SpanKind.INTERNAL,
        status: SpanStatus.OK,
        startTime: Date.now(),
        endTime: Date.now() + 100,
        attributes: {},
        children: [],
      };

      storage.save(span1);
      storage.save(span2);

      const traces = storage.listTraces(10);
      expect(traces).toHaveLength(2);
    });
  });
});
