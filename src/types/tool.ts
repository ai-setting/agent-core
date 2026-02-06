import { z } from "zod";

export interface ToolContext {
  workdir?: string;
  user_id?: string;
  session_id?: string;
  abort?: AbortSignal;
  metadata?: Record<string, unknown>;
}

export interface ToolResultMetadata {
  execution_time_ms: number;
  output_size?: number;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
  };
  [key: string]: unknown;
}

export interface ToolResult {
  success: boolean;
  output: string | Record<string, unknown>;
  error?: string;
  metadata?: ToolResultMetadata;
}

export interface ToolInfo<Parameters extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  parameters: Parameters;
  init?: (ctx?: ToolContext) => Promise<void>;
  execute: (
    args: z.infer<Parameters>,
    ctx: ToolContext,
  ) => Promise<ToolResult>;
  formatValidationError?: (error: z.ZodError) => string;
}

export type Tool = ToolInfo;
