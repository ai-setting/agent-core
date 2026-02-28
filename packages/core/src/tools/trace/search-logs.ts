import { z } from "zod";
import type { ToolInfo, ToolResult, ToolContext } from "../../core/types/tool.js";
import { createLogger } from "../../utils/logger.js";
import fs from "fs";
import path from "path";
import { xdgData } from "xdg-basedir";

const searchLogsLogger = createLogger("search-logs", "tools.log");

const DEFAULT_LOG_DIR = path.join(xdgData || "", "tong_work", "logs");

const SearchLogsParamsSchema = z.object({
  filename: z.string().describe("Log filename to search (e.g., server.log, tui.log)"),
  requestId: z.string().optional().describe("Filter by requestId/traceId"),
  traceFilter: z.enum(["all", "enter", "quit", "error"]).default("all")
    .describe("Filter by TRACE tag: enter (>>>), quit (<<<), error (!!!)"),
  keyword: z.string().optional().describe("Additional keyword to search"),
  offset: z.number().optional().default(0).describe("Line offset to start from"),
  limit: z.number().optional().default(100).describe("Maximum lines to return"),
});

export type SearchLogsParams = z.infer<typeof SearchLogsParamsSchema>;

export interface SearchLogsConfig {
  logDir?: string;
}

export function createSearchLogsTool(config?: SearchLogsConfig): ToolInfo {
  const logDir = config?.logDir || DEFAULT_LOG_DIR;

  return {
    name: "search_logs",
    description: "Search and filter log files. Supports filtering by requestId, TRACE tags (enter/quit/error), and keywords. TRACE tags: >>> (enter), <<< (quit), !!! (error)",
    parameters: SearchLogsParamsSchema,
    async execute(
      args: SearchLogsParams,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      const { filename, requestId, traceFilter, keyword, offset, limit } = args;
      
      const logFile = path.join(logDir, filename);
      
      searchLogsLogger.info("[search_logs] Searching log file", { 
        filename, 
        logFile, 
        requestId, 
        traceFilter,
        keyword,
        offset,
        limit
      });

      // Check if file exists
      if (!fs.existsSync(logFile)) {
        searchLogsLogger.warn("[search_logs] Log file not found", { logFile });
        return {
          success: false,
          output: "",
          error: `Log file not found: ${filename}`,
        };
      }

      try {
        const content = fs.readFileSync(logFile, "utf-8");
        const lines = content.split("\n");
        
        let filteredLines = lines;
        
        // Filter by requestId
        if (requestId) {
          filteredLines = filteredLines.filter(line => 
            line.includes(requestId)
          );
          searchLogsLogger.debug("[search_logs] Filtered by requestId", { requestId, count: filteredLines.length });
        }
        
        // Filter by TRACE tag type
        if (traceFilter && traceFilter !== "all") {
          const tagMap = {
            enter: "[TRACE] >>>",
            quit: "[TRACE] <<<",
            error: "[TRACE] !!!",
          };
          const targetTag = tagMap[traceFilter];
          
          filteredLines = filteredLines.filter(line => 
            line.includes(targetTag)
          );
          searchLogsLogger.debug("[search_logs] Filtered by trace tag", { tag: targetTag, count: filteredLines.length });
        }
        
        // Filter by keyword
        if (keyword) {
          filteredLines = filteredLines.filter(line => 
            line.toLowerCase().includes(keyword.toLowerCase())
          );
          searchLogsLogger.debug("[search_logs] Filtered by keyword", { keyword, count: filteredLines.length });
        }
        
        // Apply offset and limit
        const startIndex = offset || 0;
        const endIndex = startIndex + (limit || 100);
        const limitedLines = filteredLines.slice(startIndex, endIndex);
        
        const output = limitedLines.join("\n");
        
        searchLogsLogger.info("[search_logs] Search complete", { 
          filename, 
          totalMatches: filteredLines.length,
          returnedLines: limitedLines.length 
        });

        return {
          success: true,
          output: output || "No matching lines found",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        searchLogsLogger.error("[search_logs] Error reading log file", { filename, error: message });
        return {
          success: false,
          output: "",
          error: `Error reading log file: ${message}`,
        };
      }
    },
  };
}
