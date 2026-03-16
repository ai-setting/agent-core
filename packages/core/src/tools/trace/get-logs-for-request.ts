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
  startTime: z.string().optional().describe("Filter logs from this time (ISO format like '2026-03-16 11:43:59' or '11:43:59'). Only logs after this time will be returned."),
  endTime: z.string().optional().describe("Filter logs until this time (ISO format like '2026-03-16 11:44:00' or '11:44:00'). Only logs before this time will be returned."),
});

export type GetLogsForRequestParams = z.infer<typeof GetLogsForRequestParamsSchema>;

export interface GetLogsForRequestConfig {
  logDir?: string;
}

export function createGetLogsForRequestTool(config?: GetLogsForRequestConfig): ToolInfo {
  const logDir = config?.logDir || getLogDir();

  return {
    name: "get_logs_for_request",
    description: "Get all log entries for a specific requestId. Supports pagination with offset and limit. Also supports time range filtering using startTime and endTime to avoid retrieving too much data.",
    parameters: GetLogsForRequestParamsSchema,
    async execute(
      args: GetLogsForRequestParams,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      const { filename, requestId, offset, limit, startTime, endTime } = args;
      
      const logFile = path.join(logDir, filename);
      
      getLogsForRequestLogger.info("[get_logs_for_request] Getting logs for requestId", { 
        filename, 
        logFile, 
        requestId,
        offset,
        limit,
        startTime,
        endTime
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
        
        // Parse time filter
        let startTimestamp: number | undefined;
        let endTimestamp: number | undefined;
        
        if (startTime) {
          // Support both full date and time-only format
          const today = new Date().toISOString().slice(0, 10);
          const timeStr = startTime.includes(" ") ? startTime : `${today} ${startTime}`;
          startTimestamp = new Date(timeStr).getTime();
        }
        
        if (endTime) {
          const today = new Date().toISOString().slice(0, 10);
          const timeStr = endTime.includes(" ") ? endTime : `${today} ${endTime}`;
          endTimestamp = new Date(timeStr).getTime();
        }
        
        const filteredLines = lines.filter(line => {
          if (!line.trim()) return false;
          
          // Filter by requestId
          const match = line.match(requestIdRegex);
          if (!match || match[1] !== requestId) return false;
          
          // Filter by time range if specified
          if (startTimestamp !== undefined || endTimestamp !== undefined) {
            // Extract timestamp from log line (format: "2026-03-16 11:43:59.388")
            const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
            if (timeMatch) {
              const lineTimestamp = new Date(timeMatch[1]).getTime();
              if (startTimestamp !== undefined && lineTimestamp < startTimestamp) return false;
              if (endTimestamp !== undefined && lineTimestamp > endTimestamp) return false;
            }
          }
          
          return true;
        });
        
        // Filtered lines debug // 已精简
        
        const startIndex = offset || 0;
        const endIndex = startIndex + (limit || 500);
        const limitedLines = filteredLines.slice(startIndex, endIndex);
        
        const output = limitedLines.join("\n");
        
        // Build info message
        let infoMsg = "";
        if (startTimestamp || endTimestamp) {
          const timeInfo = [
            startTime ? `from ${startTime}` : "",
            endTime ? `until ${endTime}` : ""
          ].filter(Boolean).join(" ");
          infoMsg = `\n\n📅 Time filter: ${timeInfo}`;
        }
        
        getLogsForRequestLogger.info("[get_logs_for_request] Complete", { 
          requestId,
          totalMatches: filteredLines.length,
          returnedLines: limitedLines.length
        });

        const resultOutput = output 
          ? output + infoMsg 
          : "No matching lines found" + infoMsg;
          
        return {
          success: true,
          output: resultOutput,
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
