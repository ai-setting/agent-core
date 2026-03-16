import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createGetSpanDetailTool } from "./get-span-detail";
import type { ToolContext } from "../../core/types/tool";
import { SpanCollector, setSpanCollector } from "../../utils/span-collector";
import { InMemorySpanStorage } from "../../utils/span-storage";

describe("get_span_detail tool", () => {
  let collector: SpanCollector;
  let testTraceId: string;
  let testSpanId: string;
  
  beforeEach(async () => {
    const storage = new InMemorySpanStorage();
    collector = new SpanCollector(storage);
    await collector.initialize();
    setSpanCollector(collector);
    
    // Create test trace with multiple spans
    const ctx1 = collector.startSpan("agent.run", { params: { query: "test" } });
    testTraceId = ctx1.traceId;
    
    const ctx2 = collector.startSpan("env.invokeLLM", { 
      params: { 
        messages: [{ role: "user", content: "hello" }],
        model: "gpt-4"
      } 
    });
    testSpanId = ctx2.spanId;
    
    // End the spans with results
    collector.endSpan(ctx2, { 
      content: "Hello! How can I help you today?",
      reasoning: "The user is greeting me",
      tool_calls: [],
      model: "gpt-4"
    });
    
    collector.endSpan(ctx1, { success: true });
  });
  
  afterEach(() => {
    setSpanCollector(null as any);
  });
  
  it("should return detailed info for a specific span", async () => {
    const tool = createGetSpanDetailTool();
    
    const result = await tool.execute(
      { spanId: testSpanId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("env.invokeLLM");
    expect(result.output).toContain(testSpanId);
    expect(result.output).toContain("params");
    expect(result.output).toContain("messages");
    expect(result.output).toContain("Result:");
  });
  
  it("should include params/attributes in output", async () => {
    const tool = createGetSpanDetailTool();
    
    const result = await tool.execute(
      { spanId: testSpanId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("messages");
    expect(result.output).toContain("hello");
    expect(result.output).toContain("model");
    expect(result.output).toContain("gpt-4");
  });
  
  it("should include result in output", async () => {
    const tool = createGetSpanDetailTool();
    
    const result = await tool.execute(
      { spanId: testSpanId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("Hello! How can I help you today?");
  });
  
  it("should include timing information", async () => {
    const tool = createGetSpanDetailTool();
    
    const result = await tool.execute(
      { spanId: testSpanId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("startTime");
    expect(result.output).toContain("endTime");
    expect(result.output).toContain("duration");
  });
  
  it("should include traceId and parent info", async () => {
    const tool = createGetSpanDetailTool();
    
    const result = await tool.execute(
      { spanId: testSpanId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("traceId");
    expect(result.output).toContain("parentSpanId");
  });
  
  it("should return error for non-existent span", async () => {
    const tool = createGetSpanDetailTool();
    
    const result = await tool.execute(
      { spanId: "non_existent_span_id" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
  
  it("should return error when no collector is initialized", async () => {
    setSpanCollector(null as any);
    
    const tool = createGetSpanDetailTool();
    const result = await tool.execute(
      { spanId: "any_id" },
      {} as ToolContext
    );
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("not initialized");
  });
  
  it("should handle spans without result", async () => {
    const tool = createGetSpanDetailTool();
    
    // Use the root span which doesn't have a result
    const ctx = collector.startSpan("test.span.no.result", { params: { test: true } });
    collector.endSpan(ctx);
    
    const result = await tool.execute(
      { spanId: ctx.spanId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("test.span.no.result");
    // Result section should not be present or be empty
    expect(result.output).not.toContain("📤 Result:");
  });
  
  it("should handle spans with error", async () => {
    const ctx = collector.startSpan("error.span", { params: { test: true } });
    collector.endSpan(ctx, undefined, new Error("Something went wrong"));
    
    const tool = createGetSpanDetailTool();
    const result = await tool.execute(
      { spanId: ctx.spanId },
      {} as ToolContext
    );
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("error.span");
    expect(result.output).toContain("Something went wrong");
    expect(result.output).toContain("❌ Error:");
  });
});
