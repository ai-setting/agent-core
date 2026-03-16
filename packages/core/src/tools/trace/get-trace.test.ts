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
});
