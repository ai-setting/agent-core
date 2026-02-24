/**
 * @fileoverview LSP Tool - Allows Agent to query code intelligence
 */

import { z } from "zod";
import path from "path";
import { lspManager, type LSPOperation } from "./index.js";
import { createLogger } from "../../../utils/logger.js";
import type { ToolInfo, ToolResultMetadata, ToolContext } from "../../types/tool.js";

const lspLogger = createLogger("lsp:tool", "server.log");

const operationSchema = z.enum([
  "goToDefinition",
  "findReferences",
  "hover",
  "documentSymbol",
  "workspaceSymbol",
  "goToImplementation",
]);

const LSP_TOOL_DESCRIPTION = `
Interact with Language Server Protocol (LSP) servers to get code intelligence features.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols in a document
- workspaceSymbol: Search for symbols across the workspace
- goToImplementation: Find implementations of an interface

All operations require:
- filePath: The file to operate on
- line: The line number (1-based)
- character: The character offset (1-based)

Note: LSP servers must be configured for the file type. If no server is available, an error will be returned.
`.trim();

export interface LSPToolParams {
  operation: LSPOperation;
  filePath: string;
  line: number;
  character: number;
}

/**
 * Create the LSP tool
 */
export function createLSPTool(): ToolInfo {
  return {
    name: "lsp",
    description: LSP_TOOL_DESCRIPTION,
    parameters: z.object({
      operation: operationSchema.describe("The LSP operation to perform"),
      filePath: z.string().describe("The absolute or relative path to the file"),
      line: z.number().int().min(1).describe("The line number (1-based)"),
      character: z.number().int().min(1).describe("The character offset (1-based)"),
    }),
    execute: async (args: { operation: LSPOperation; filePath: string; line: number; character: number }, ctx: ToolContext): Promise<{ success: boolean; output: string; error?: string; metadata?: ToolResultMetadata }> => {
      const workdir = ctx.workdir || process.cwd();
      const filePath = path.isAbsolute(args.filePath)
        ? args.filePath
        : path.join(workdir, args.filePath);

      // Check if file needs LSP
      if (!lspManager.needsLSP(filePath)) {
        return {
          success: false,
          output: "",
          error: "File type does not require LSP (not a code file)",
        };
      }

      // Check if LSP server is available
      const hasLSP = await lspManager.hasLSPForFile(filePath);
      if (!hasLSP) {
        return {
          success: false,
          output: "",
          error: "No LSP server available for this file type",
        };
      }

      try {
        // Execute LSP operation
        const result = await lspManager.executeOperation(
          args.operation,
          filePath,
          args.line,
          args.character
        );

        if (!result || (Array.isArray(result) && result.length === 0)) {
          return {
            success: true,
            output: `No results found for ${args.operation}`,
            metadata: {
              execution_time_ms: Date.now(),
            },
          };
        }

        return {
          success: true,
          output: JSON.stringify(result, null, 2),
          metadata: {
            execution_time_ms: Date.now(),
            operation: args.operation,
            filePath,
          },
        };
      } catch (error) {
        lspLogger.error("LSP operation failed", {
          operation: args.operation,
          filePath,
          error: (error as Error).message,
        });

        return {
          success: false,
          output: "",
          error: `LSP operation failed: ${(error as Error).message}`,
          metadata: {
            execution_time_ms: Date.now(),
          },
        };
      }
    },
  };
}
