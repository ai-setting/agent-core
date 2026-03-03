import { z } from "zod";
import type { ISandboxProvider } from "../sandbox/types.js";

const SandboxFilesystemConfig = z.object({
  denyRead: z.array(z.string()).optional(),
  allowWrite: z.array(z.string()).optional(),
  denyWrite: z.array(z.string()).optional(),
});

const SandboxNetworkConfig = z.object({
  allowedDomains: z.array(z.string()).optional(),
  deniedDomains: z.array(z.string()).optional(),
});

const SandboxDockerConfig = z.object({
  image: z.string().optional(),
  networkMode: z.enum(["bridge", "host", "none"]).optional(),
  volumes: z.record(z.string(), z.string()).optional(),
});

const SandboxActionFilterConfig = z.object({
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

const SandboxConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  type: z.enum(["native", "docker"]).default("native"),
  actionFilter: SandboxActionFilterConfig.optional(),
  filesystem: SandboxFilesystemConfig.optional(),
  network: SandboxNetworkConfig.optional(),
  docker: SandboxDockerConfig.optional(),
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

export interface ToolContext {
  workdir?: string;
  user_id?: string;
  session_id?: string;
  message_id?: string;
  abort?: AbortSignal;
  metadata?: Record<string, unknown>;
  sandbox?: SandboxConfig;
  sandboxProvider?: ISandboxProvider | null;
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
