import { z } from "zod";
import type { ToolInfo, ToolContext, ToolResult } from "../../types/tool.js";

export const InvalidToolParameters = z.object({
  tool: z.string().describe("The name of the tool that was called with invalid arguments"),
  error: z.string().describe("The error message describing why the arguments were invalid"),
});

type InvalidToolParams = z.infer<typeof InvalidToolParameters>;

export function createInvalidTool(): ToolInfo {
  return {
    name: "invalid",
    description: "Internal tool for reporting invalid tool calls. Do not call this tool directly - it is called automatically when a tool is invoked with invalid arguments.",
    parameters: InvalidToolParameters,
    execute: async (args: InvalidToolParams, ctx: ToolContext): Promise<ToolResult> => {
      const startTime = Date.now();
      return {
        success: false,
        output: "",
        error: `The arguments provided to the tool are invalid: ${args.error}`,
        metadata: {
          execution_time_ms: Date.now() - startTime,
          original_tool: args.tool,
          error_message: args.error,
        },
      };
    },
  };
}
