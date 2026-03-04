import { z } from "zod";
import type { ToolInfo, ToolResult, ToolContext } from "../../core/types/tool.js";
import { createLogger, getLogDir } from "../../utils/logger.js";
import fs from "fs";
import path from "path";

const getLogsForRequestLogger = createLogger("get-logs-for-request", "tools.log", "debug");

const GetLogsForRequestParamsSchema = z.object({
  filename: z.string().describe("Log filename (e.g., server.log, tui.log, tools.log). Do NOT include path or directory prefix. The file must be in the configured log directory."),
  requestId: z.string().describe("The requestId to get all logs for"),
  offset: z.number().optional().default(0).describe("Line offset to start from"),
  limit: z.number().optional().default(500).describe("Maximum lines to return"),
});

export type GetLogsForRequestParams = z.infer<typeof GetLogsForRequestParamsSchema>;

export interface GetLogsForRequestConfig {
  logDir?: string;
}

export function createGetLogsForRequestTool(config?: GetLogsForRequestConfig): ToolInfo {
  const logDir = config?.logDir || getLogDir();

  return {
    name: "get_logs_for_request",
    description: "Get all log entries for a specific requestId. Supports pagination with offset and limit parameters.",
    parameters: GetLogsForRequestParamsSchema,
    async execute(
      args: GetLogsForRequestParams,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      const { filename, requestId, offset, limit } = args;
      
      const logFile = path.join(logDir, filename);
      
      getLogsForRequestLogger.info("[get_logs_for_request] Getting logs for requestId", { 
        filename, 
        logFile, 
        requestId,
        offset,
        limit
      });

      if (!fs.existsSync(logFile)) {
        getLogsForRequestLogger.warn("[get_logs_for_request] Log file not found", { logFile });
        return {
          success: false,
          output: "",
          error: `Log file not found: ${filename}`,
        };
      }

      try {
        const content = fs.readFileSync(logFile, "utf-8");
        const lines = content.split("\n");
        
        const requestIdRegex = /\[requestId=([^\]]+)\]/;
        
        const filteredLines = lines.filter(line => {
          if (!line.trim()) return false;
          const match = line.match(requestIdRegex);
          return match && match[1] === requestId;
        });
        
        getLogsForRequestLogger.debug("[get_logs_for_request] Filtered lines", { 
          requestId, 
          count: filteredLines.length 
        });
        
        const startIndex = offset || 0;
        const endIndex = startIndex + (limit || 500);
        const limitedLines = filteredLines.slice(startIndex, endIndex);
        
        const output = limitedLines.join("\n");
        
        getLogsForRequestLogger.info("[get_logs_for_request] Complete", { 
          requestId,
          totalMatches: filteredLines.length,
          returnedLines: limitedLines.length
        });

        return {
          success: true,
          output: output || "No matching lines found",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        getLogsForRequestLogger.error("[get_logs_for_request] Error reading log file", { filename, error: message });
        return {
          success: false,
          output: "",
          error: `Error reading log file: ${message}`,
        };
      }
    },
  };
}
