import { z } from "zod";
import type { ToolInfo, ToolResult, ToolContext } from "../../core/types/tool.js";
import { createLogger } from "../../utils/logger.js";
import { getSpanCollector } from "../../utils/span-collector.js";

const getSpanDetailLogger = createLogger("get-span-detail", "tools.log", "debug");

const GetSpanDetailParamsSchema = z.object({
  spanId: z.string().describe("The spanId to get detailed information for. You can get this from get_trace output."),
});

export type GetSpanDetailParams = z.infer<typeof GetSpanDetailParamsSchema>;

export function createGetSpanDetailTool(): ToolInfo {
  return {
    name: "get_span_detail",
    description: "Get detailed information for a specific span by spanId. Use this after get_trace to dive into specific function calls. Returns params, result (if recorded), error, and timing info.",
    parameters: GetSpanDetailParamsSchema,
    async execute(
      args: GetSpanDetailParams,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      const { spanId } = args;
      
      getSpanDetailLogger.info("[get_span_detail] Querying span", { spanId });

      const collector = getSpanCollector();
      
      if (!collector) {
        getSpanDetailLogger.warn("[get_span_detail] SpanCollector not initialized");
        return {
          success: false,
          output: "",
          error: "Trace collector not initialized",
        };
      }

      try {
        const span = collector.getSpanById(spanId);
        
        if (!span) {
          getSpanDetailLogger.warn("[get_span_detail] Span not found", { spanId });
          return {
            success: false,
            output: "",
            error: `Span not found for spanId: ${spanId}`,
          };
        }

        // Build detailed output
        const lines: string[] = [];
        lines.push(`\n📌 Span Detail: ${span.name}`);
        lines.push(`─────────────────────────────────────`);
        lines.push(`spanId: ${span.spanId}`);
        lines.push(`traceId: ${span.traceId}`);
        if (span.parentSpanId) {
          lines.push(`parentSpanId: ${span.parentSpanId}`);
        }
        lines.push(`kind: ${span.kind}`);
        lines.push(`status: ${span.status}`);
        lines.push(`startTime: ${span.startTime}`);
        lines.push(`endTime: ${span.endTime || "N/A"}`);
        
        const duration = span.endTime ? span.endTime - span.startTime : 0;
        lines.push(`duration: ${duration}ms`);
        
        // Attributes (params)
        if (span.attributes && Object.keys(span.attributes).length > 0) {
          lines.push(`\n📥 Params / Attributes:`);
          lines.push(`─────────────────────────────────────`);
          for (const [key, value] of Object.entries(span.attributes)) {
            const valueStr = typeof value === "string" ? value : JSON.stringify(value, null, 2);
            // Truncate long values for display
            const truncated = valueStr.length > 2000 
              ? valueStr.slice(0, 2000) + `\n... [truncated, total ${valueStr.length} chars]`
              : valueStr;
            lines.push(`\n${key}:`);
            lines.push(truncated);
          }
        }
        
        // Result
        if (span.result !== undefined) {
          lines.push(`\n📤 Result:`);
          lines.push(`─────────────────────────────────────`);
          const resultStr = typeof span.result === "string" 
            ? span.result 
            : JSON.stringify(span.result, null, 2);
          // Truncate long results for display
          const truncated = resultStr.length > 5000 
            ? resultStr.slice(0, 5000) + `\n... [truncated, total ${resultStr.length} chars]`
            : resultStr;
          lines.push(truncated);
        }
        
        // Error
        if (span.error) {
          lines.push(`\n❌ Error:`);
          lines.push(`─────────────────────────────────────`);
          lines.push(span.error);
        }
        
        // Children summary
        if (span.children && span.children.length > 0) {
          lines.push(`\n👶 Children (${span.children.length}):`);
          lines.push(`─────────────────────────────────────`);
          for (const child of span.children) {
            const childDuration = child.endTime ? child.endTime - child.startTime : 0;
            lines.push(`  - ${child.name} [${childDuration}ms] (${child.spanId})`);
          }
        }

        getSpanDetailLogger.info("[get_span_detail] Span found", { 
          spanId, 
          name: span.name,
          hasResult: span.result !== undefined 
        });

        return {
          success: true,
          output: lines.join("\n"),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        getSpanDetailLogger.error("[get_span_detail] Error querying span", { spanId, error: message });
        return {
          success: false,
          output: "",
          error: `Error querying span: ${message}`,
        };
      }
    },
  };
}
