import { z } from "zod";
import type { ToolInfo, ToolResult, ToolContext } from "../../core/types/tool.js";
import { createLogger, getLogDir } from "../../utils/logger.js";
import fs from "fs";
import path from "path";

const listRequestIdsLogger = createLogger("list-request-ids", "tools.log", "debug");

const ListRequestIdsParamsSchema = z.object({
  filename: z.string().describe("Log filename (e.g., server.log, tui.log, tools.log). Do NOT include path or directory prefix. The file must be in the configured log directory."),
  limit: z.number().optional().default(50).describe("Maximum number of requestIds to return"),
  offset: z.number().optional().default(0).describe("Offset for pagination (use with limit to paginate through requestIds)"),
  includeFirstLog: z.boolean().optional().default(true).describe("Whether to include the first log line for each requestId"),
  logDir: z.string().optional().describe("Log directory path. Must be an absolute path. If provided, the tool will look for log files in this directory instead of the default log directory."),
});

export type ListRequestIdsParams = z.infer<typeof ListRequestIdsParamsSchema>;

export interface RequestIdInfo {
  requestId: string;
  firstLogTime: string;
  lastLogTime: string;
  firstLog?: string;
}

export interface ListRequestIdsConfig {
  logDir?: string;
}

export function createListRequestIdsTool(config?: ListRequestIdsConfig): ToolInfo {
  const logDir = config?.logDir || getLogDir();

  return {
    name: "list_request_ids",
    description: "List all unique requestIds in a log file, sorted by time (newest first). Returns each requestId with its first and last log timestamp, and optionally the first log line (which typically contains the user's query).",
    parameters: ListRequestIdsParamsSchema,
    async execute(
      args: ListRequestIdsParams,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      // Parse args to apply defaults
      const parsedArgs = ListRequestIdsParamsSchema.parse(args);
      const { filename, limit, offset, includeFirstLog, logDir: userLogDir } = parsedArgs;

      // Use user-provided logDir if valid, otherwise fall back to config/default
      const effectiveLogDir = userLogDir || logDir;
      
      // Validate that logDir is absolute path if provided
      if (userLogDir && !path.isAbsolute(userLogDir)) {
        return {
          success: false,
          output: "",
          error: `logDir must be an absolute path, got: ${userLogDir}`,
        };
      }

      const logFile = path.join(effectiveLogDir, filename);

      // 在返回结果中包含日志文件路径，方便调试
      const debugInfo = {
        logFile,
        logDir: effectiveLogDir
      };

      listRequestIdsLogger.info("[list_request_ids] Listing requestIds", {
        filename,
        logFile,
        logDir: effectiveLogDir,
        userLogDir,
        limit,
        offset,
        includeFirstLog
      });

      if (!fs.existsSync(logFile)) {
        listRequestIdsLogger.warn("[list_request_ids] Log file not found", { logFile, effectiveLogDir });
        return {
          success: false,
          output: "",
          error: `Log file not found: ${filename} (searched in: ${effectiveLogDir})`,
        };
      }

      try {
        const content = fs.readFileSync(logFile, "utf-8");
        const lines = content.split("\n");
        
        const requestIdMap = new Map<string, { first: string; last: string; firstLine?: string }>();
        
        const requestIdRegex = /\[requestId=([^\]]+)\]/;
        
        let currentRequestId: string | null = null;
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          const timestamp = line.substring(0, 23);
          const match = line.match(requestIdRegex);
          if (match) {
            currentRequestId = match[1];
          }
          
          if (currentRequestId) {
            if (!requestIdMap.has(currentRequestId)) {
              requestIdMap.set(currentRequestId, { 
                first: timestamp, 
                last: timestamp,
                firstLine: includeFirstLog ? line : undefined 
              });
            } else {
              const existing = requestIdMap.get(currentRequestId)!;
              existing.last = timestamp;
            }
          }
        }
        
        const result: RequestIdInfo[] = [];
        for (const [requestId, data] of requestIdMap) {
          const info: RequestIdInfo = {
            requestId,
            firstLogTime: data.first,
            lastLogTime: data.last,
          };
          if (includeFirstLog && data.firstLine) {
            info.firstLog = data.firstLine;
          }
          result.push(info);
        }
        
        result.sort((a, b) => {
          return b.lastLogTime.localeCompare(a.lastLogTime);
        });
        
        const startIndex = offset || 0;
        const paginatedResult = result.slice(startIndex, startIndex + (limit || 50));
        
        listRequestIdsLogger.info("[list_request_ids] Complete", {
          totalRequestIds: result.length,
          offset: startIndex,
          returned: paginatedResult.length
        });

        return {
          success: true,
          output: JSON.stringify({
            _debug: debugInfo,
            requestIds: paginatedResult
          }, null, 2),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        listRequestIdsLogger.error("[list_request_ids] Error reading log file", { filename, effectiveLogDir, error: message });
        return {
          success: false,
          output: "",
          error: `Error reading log file: ${message} (directory: ${effectiveLogDir})`,
        };
      }
    },
  };
}
