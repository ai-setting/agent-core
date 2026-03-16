import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createGetTraceTool } from "./get-trace";
import type { ToolContext } from "../../core/types/tool";
import { SpanCollector, setSpanCollector } from "../../utils/span-collector";
import { InMemorySpanStorage } from "../../utils/span-storage";

describe("get_trace tool", () => {
  let collector: SpanCollector;
  let testTraceId: string;
  
  beforeEach(async () => {
    const storage = new InMemorySpanStorage();
    collector = new SpanCollector(storage);
    await collector.initialize();
    setSpanCollector(collector);
    
    // Create test trace and save the traceId before ending
    collector.startSpan("agent.run");
    const ctx = collector.getCurrentContext();
    testTraceId = ctx?.traceId || "";
    
    collector.startSpan("tool:read");
    collector.endSpan(collector.getCurrentContext()!);
    collector.startSpan("tool:write");
    collector.endSpan(collector.getCurrentContext()!);
    collector.endSpan(collector.getCurrentContext()!);
  });
  
  afterEach(() => {
    setSpanCollector(null as any);
  });
  
  it("should return formatted trace with spanId", async () => {
    const tool = createGetTraceTool();
    
    const result = await tool.execute(
      { requestId: testTraceId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("agent.run");
    expect(result.output).toContain("tool:read");
    expect(result.output).toContain("tool:write");
    expect(result.output).toContain("spanId:");
  });
  
  it("should return error for non-existent trace", async () => {
    const tool = createGetTraceTool();
    
    const result = await tool.execute(
      { requestId: "non_existent_trace_id" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
  
  it("should return error when no collector is initialized", async () => {
    setSpanCollector(null as any);
    
    const tool = createGetTraceTool();
    const result = await tool.execute(
      { requestId: "any_id" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("not initialized");
  });
  
  it("should find trace by partial match", async () => {
    const tool = createGetTraceTool();
    
    // Use only part of the traceId
    const partialId = testTraceId.slice(0, 10);
    
    const result = await tool.execute(
      { requestId: partialId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("agent.run");
  });
  
  it("should include total span count", async () => {
    const tool = createGetTraceTool();
    
    const result = await tool.execute(
      { requestId: testTraceId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("Total spans:");
  });
  
  it("should include usage tip", async () => {
    const tool = createGetTraceTool();
    
    const result = await tool.execute(
      { requestId: testTraceId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("get_span_detail");
  });

  // ==================== Time Info Tests ====================

  it("should show time range at the top of trace output", async () => {
    // Create a new collector with specific timestamps
    const storage = new InMemorySpanStorage();
    const timedCollector = new SpanCollector(storage);
    await timedCollector.initialize();
    setSpanCollector(timedCollector);
    
    // Start a span
    timedCollector.startSpan("agent.run", { params: { query: "test" } });
    const ctx = timedCollector.getCurrentContext();
    const traceId = ctx?.traceId || "";
    
    // End the span after a delay
    await new Promise(resolve => setTimeout(resolve, 10));
    timedCollector.endSpan(ctx!, { result: "ok" });
    
    const tool = createGetTraceTool();
    const result = await tool.execute(
      { requestId: traceId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("Time Range:");
    // Should show time range in HH:MM:SS.mmm format
    expect(result.output).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  it("should show startTime->endTime for each span", async () => {
    const storage = new InMemorySpanStorage();
    const timedCollector = new SpanCollector(storage);
    await timedCollector.initialize();
    setSpanCollector(timedCollector);
    
    timedCollector.startSpan("parent.span", { params: {} });
    const parentCtx = timedCollector.getCurrentContext();
    const traceId = parentCtx?.traceId || "";
    
    // Create child span
    timedCollector.startSpan("child.span", { params: { data: "test" } });
    const childCtx = timedCollector.getCurrentContext();
    timedCollector.endSpan(childCtx!, { result: "child result" });
    
    // End parent
    await new Promise(resolve => setTimeout(resolve, 5));
    timedCollector.endSpan(parentCtx!, { result: "parent result" });
    
    const tool = createGetTraceTool();
    const result = await tool.execute(
      { requestId: traceId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    // Each span should show time with arrow (Unicode arrow character)
    expect(result.output).toContain(String.fromCharCode(8594)); // →
    // Should have time arrows for both parent and child
    const timeArrows = result.output.match(/\d{2}:\d{2}:\d{2}\.\d{3}→\d{2}:\d{2}:\d{2}\.\d{3}/g);
    expect(timeArrows).toBeDefined();
    expect(timeArrows!.length).toBeGreaterThanOrEqual(2); // parent + child
  });

  it("should show duration for each span", async () => {
    const tool = createGetTraceTool();
    
    const result = await tool.execute(
      { requestId: testTraceId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    // Duration should be in format [Xms]
    expect(result.output).toContain("[");
    expect(result.output).toContain("ms]");
  });

  it("should show status icon for each span", async () => {
    const tool = createGetTraceTool();
    
    const result = await tool.execute(
      { requestId: testTraceId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    // Should have ✓ for successful spans
    expect(result.output).toContain("✓");
  });

  it("should show ongoing for spans that haven't ended", async () => {
    const storage = new InMemorySpanStorage();
    const timedCollector = new SpanCollector(storage);
    await timedCollector.initialize();
    setSpanCollector(timedCollector);
    
    // Start a span but don't end it
    timedCollector.startSpan("ongoing.span", { params: {} });
    const ctx = timedCollector.getCurrentContext();
    const traceId = ctx?.traceId || "";
    
    const tool = createGetTraceTool();
    const result = await tool.execute(
      { requestId: traceId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("ongoing");
  });

  it("should correctly format time with milliseconds", async () => {
    const storage = new InMemorySpanStorage();
    const timedCollector = new SpanCollector(storage);
    await timedCollector.initialize();
    setSpanCollector(timedCollector);
    
    timedCollector.startSpan("test.span", { params: {} });
    const ctx = timedCollector.getCurrentContext();
    const traceId = ctx?.traceId || "";
    
    timedCollector.endSpan(ctx!, { result: "ok" });
    
    const tool = createGetTraceTool();
    const result = await tool.execute(
      { requestId: traceId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    // Verify the format matches expected pattern: HH:MM:SS.mmm
    const timePattern = /\d{2}:\d{2}:\d{2}\.\d{3}/;
    expect(result.output).toMatch(timePattern);
  });
});
