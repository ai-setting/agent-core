import { z } from "zod";
import type { ToolInfo, ToolResult, ToolContext } from "../../core/types/tool.js";
import { createLogger } from "../../utils/logger.js";
import { getSpanCollector } from "../../utils/span-collector.js";

const getTraceLogger = createLogger("get-trace", "tools.log");

const GetTraceParamsSchema = z.object({
  requestId: z.string().describe("The requestId/traceId to query"),
  format: z.enum(["text", "json"]).default("text").describe("Output format: text (human readable) or json"),
});

export type GetTraceParams = z.infer<typeof GetTraceParamsSchema>;

export function createGetTraceTool(): ToolInfo {
  return {
    name: "get_trace",
    description: "Get the trace/call chain for a given requestId. Returns formatted call tree showing the execution flow with duration. Use requestId from log files or previous trace queries.",
    parameters: GetTraceParamsSchema,
    async execute(
      args: GetTraceParams,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      const { requestId, format } = args;
      
      getTraceLogger.info("[get_trace] Querying trace", { requestId, format });

      const collector = getSpanCollector();
      
      if (!collector) {
        getTraceLogger.warn("[get_trace] SpanCollector not initialized");
        return {
          success: false,
          output: "",
          error: "Trace collector not initialized",
        };
      }

      try {
        // Try to find the trace - could be exact match or partial match
        const traces = collector.listTraces(100);
        
        // Find trace by exact requestId or partial match
        const matchingTrace = traces.find(t => 
          t.traceId === requestId || requestId.includes(t.traceId) || t.traceId.includes(requestId)
        );
        
        if (!matchingTrace) {
          // Try to get trace directly by requestId even if not in recent list
          const spans = collector.getTrace(requestId);
          if (spans.length === 0) {
            getTraceLogger.warn("[get_trace] Trace not found", { requestId });
            return {
              success: false,
              output: "",
              error: `Trace not found for requestId: ${requestId}`,
            };
          }
          
          // Found trace, format it
          if (format === "json") {
            const json = collector.exportTrace(requestId);
            getTraceLogger.info("[get_trace] Trace found (json)", { requestId, spanCount: spans.length });
            return {
              success: true,
              output: json,
            };
          } else {
            const text = collector.formatTrace(requestId);
            getTraceLogger.info("[get_trace] Trace found (text)", { requestId, spanCount: spans.length });
            return {
              success: true,
              output: text,
            };
          }
        }
        
        const traceId = matchingTrace.traceId;
        
        if (format === "json") {
          const json = collector.exportTrace(traceId);
          getTraceLogger.info("[get_trace] Trace found (json)", { requestId, traceId });
          return {
            success: true,
            output: json,
          };
        } else {
          const text = collector.formatTrace(traceId);
          getTraceLogger.info("[get_trace] Trace found (text)", { requestId, traceId });
          return {
            success: true,
            output: text,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        getTraceLogger.error("[get_trace] Error querying trace", { requestId, error: message });
        return {
          success: false,
          output: "",
          error: `Error querying trace: ${message}`,
        };
      }
    },
  };
}
