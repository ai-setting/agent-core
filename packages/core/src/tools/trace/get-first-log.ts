import { z } from "zod";
import type { ToolInfo, ToolResult, ToolContext } from "../../core/types/tool.js";
import { createLogger, getLogDir } from "../../utils/logger.js";
import fs from "fs";
import path from "path";

const getFirstLogLogger = createLogger("get-first-log", "tools.log", "debug");

const GetFirstLogParamsSchema = z.object({
  filename: z.string().describe("Log filename (e.g., server.log, tui.log, tools.log). Do NOT include path or directory prefix. The file must be in the configured log directory."),
  requestIds: z.array(z.string()).describe("List of requestIds to get first log for"),
});

export type GetFirstLogParams = z.infer<typeof GetFirstLogParamsSchema>;

export interface GetFirstLogConfig {
  logDir?: string;
}

export function createGetFirstLogTool(config?: GetFirstLogConfig): ToolInfo {
  const logDir = config?.logDir || getLogDir();

  return {
    name: "get_first_log_for_request",
    description: "Get the first log entry for each specified requestId. The first entry typically contains the user's query. Returns a JSON object mapping requestId to its first log line.",
    parameters: GetFirstLogParamsSchema,
    async execute(
      args: GetFirstLogParams,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      const { filename, requestIds } = args;
      
      const logFile = path.join(logDir, filename);
      
      getFirstLogLogger.info("[get_first_log_for_request] Getting first logs", { 
        filename, 
        logFile, 
        requestIds: requestIds.join(", ")
      });

      if (!fs.existsSync(logFile)) {
        getFirstLogLogger.warn("[get_first_log_for_request] Log file not found", { logFile });
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
        const firstLogMap = new Map<string, string>();
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          const match = line.match(requestIdRegex);
          if (match) {
            const requestId = match[1];
            if (requestIds.includes(requestId) && !firstLogMap.has(requestId)) {
              firstLogMap.set(requestId, line);
            }
          }
        }
        
        const result: Record<string, string> = {};
        for (const requestId of requestIds) {
          if (firstLogMap.has(requestId)) {
            result[requestId] = firstLogMap.get(requestId)!;
          } else {
            result[requestId] = "[NOT FOUND]";
          }
        }
        
        getFirstLogLogger.info("[get_first_log_for_request] Complete", { 
          requested: requestIds.length,
          found: Object.keys(result).filter(k => result[k] !== "[NOT FOUND]").length
        });

        return {
          success: true,
          output: JSON.stringify(result, null, 2),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        getFirstLogLogger.error("[get_first_log_for_request] Error reading log file", { filename, error: message });
        return {
          success: false,
          output: "",
          error: `Error reading log file: ${message}`,
        };
      }
    },
  };
}
