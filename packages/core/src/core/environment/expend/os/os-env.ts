/**
 * @fileoverview Operating system environment implementation.
 * Provides concrete OS-specific tool execution and environment management.
 */

import { z } from "zod";
import {
  BaseEnvironment,
  TimeoutManager,
  RetryManager,
  ConcurrencyManager,
  type ToolRegistration,
} from "../../base/index.js";
import type {
  Context,
  Action,
  ToolResult,
  Tool,
  ToolInfo,
} from "../../../types/index.js";
import { normalizePath } from "./tools/filesystem.js";

/**
 * OS-specific tool execution configuration.
 */
export interface OsEnvConfig {
  /** Default timeout for bash commands (ms). */
  defaultBashTimeoutMs?: number;
  /** Default timeout for file operations (ms). */
  defaultFileTimeoutMs?: number;
  /** Default timeout for network operations (ms). */
  defaultNetworkTimeoutMs?: number;
  /** Maximum concurrent bash processes. */
  maxConcurrentBash?: number;
  /** Maximum concurrent file operations. */
  maxConcurrentFileOps?: number;
  /** Working directory for command execution. */
  workdir?: string;
  /** Environment variables to set. */
  envVars?: Record<string, string>;
  /** LLM model to use (e.g., "openai/gpt-4o", "kimi/kimi-k2.5"). Auto-configures LLM. */
  model?: string;
  /** Base URL for the LLM API (optional, provider-specific default used if not provided). */
  baseURL?: string;
  /** API key for the LLM provider (optional, reads from env var if not provided). */
  apiKey?: string;
  /** System prompt for the agent. */
  systemPrompt?: string;
}

const DEFAULT_TIMEOUTS: Record<string, number> = {
  bash: 60000,
  file_read: 10000,
  file_write: 10000,
  file_glob: 5000,
  file_grep: 10000,
  network_fetch: 30000,
  default: 60000,
};

const DEFAULT_CONCURRENCY_LIMITS: Record<string, number> = {
  bash: 4,
  file_read: 10,
  file_write: 5,
  file_glob: 10,
  file_grep: 10,
  network_fetch: 5,
  default: 10,
};

const RETRY_CONFIGS: Record<string, { maxRetries: number; baseDelayMs: number }> = {
  network: { maxRetries: 3, baseDelayMs: 1000 },
  file: { maxRetries: 2, baseDelayMs: 500 },
  bash: { maxRetries: 1, baseDelayMs: 1000 },
  default: { maxRetries: 2, baseDelayMs: 500 },
};

export { createOsTools, createTodoTools } from "./tools/index.js";
export * from "./tools/index.js";

/**
 * Operating system environment for agent tool execution.
 *
 * @example
 * ```typescript
 * const env = new OsEnv({
 *   model: "openai/gpt-4o",
 *   workdir: "/home/user/project"
 * });
 * await env.handle_query("list files in current directory", context);
 * ```
 */
export class OsEnv extends BaseEnvironment {
  private workdir: string;
  private envVars: Map<string, string>;
  private processConfig: {
    maxBuffer: number;
    encoding: BufferEncoding;
    shell: string;
  };

  constructor(config?: OsEnvConfig) {
    super({
      defaultTimeoutMs: DEFAULT_TIMEOUTS.default,
      defaultConcurrencyLimit: DEFAULT_CONCURRENCY_LIMITS.default,
      defaultMaxRetries: RETRY_CONFIGS.default.maxRetries,
      systemPrompt: config?.systemPrompt,
    });

    this.workdir = config?.workdir ?? process.cwd();
    this.envVars = new Map(Object.entries(config?.envVars ?? {}));

    this.processConfig = {
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
      shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
    };

    this.configureDefaults();

    const model = config?.model ?? process.env.LLM_MODEL;
    const apiKey = config?.apiKey ?? process.env.LLM_API_KEY;
    const baseURL = config?.baseURL ?? process.env.LLM_BASE_URL;

    if (model) {
      this.llmConfigPromise = this.configureLLMWithModel(model, baseURL, apiKey);
    }
  }

  private llmConfigPromise: Promise<void> | null = null;

  static async create(config?: OsEnvConfig): Promise<OsEnv> {
    const model = config?.model ?? process.env.LLM_MODEL;
    const apiKey = config?.apiKey ?? process.env.LLM_API_KEY;
    const baseURL = config?.baseURL ?? process.env.LLM_BASE_URL;

    const env = new OsEnv({ model, apiKey, baseURL });
    await env.registerDefaultTools();
    await env.waitForLLM();
    return env;
  }

  async waitForLLM(): Promise<void> {
    if (this.llmConfigPromise) {
      await this.llmConfigPromise;
    }
  }

  private async registerDefaultTools(): Promise<void> {
    const { createOsTools, createTodoTools, createWebFetchTool } = await import("./tools/index.js");
    const osTools = createOsTools();
    const todoTools = createTodoTools();
    const webFetchTool = createWebFetchTool({
      maxChars: 50000,
      timeout: 30000,
    });
    
    console.log("[OsEnv] Registering tools", {
      osTools: osTools.map((t: any) => t.name),
      todoTools: todoTools.map((t: any) => t.name),
      webFetchTool: webFetchTool.name,
    });
    
    for (const tool of [...osTools, ...todoTools, webFetchTool]) {
      this.registerTool(tool);
    }
    
    console.log("[OsEnv] Registered tools count:", this.listTools().length);
  }

  private configureDefaults(): void {
    this.timeoutManager = new TimeoutManager({
      defaultTimeoutMs: DEFAULT_TIMEOUTS.default,
    });

    this.retryManager = new RetryManager({
      maxRetries: RETRY_CONFIGS.default.maxRetries,
      baseDelayMs: RETRY_CONFIGS.default.baseDelayMs,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitter: true,
    });

    this.concurrencyManager = new ConcurrencyManager({
      defaultLimit: DEFAULT_CONCURRENCY_LIMITS.default,
      maxWaitTimeMs: 60000,
    });
  }

  getWorkdir(): string {
    return this.workdir;
  }

  protected getSkillsDirectory(): string | undefined {
    return undefined;
  }

  setWorkdir(path: string): void {
    this.workdir = path;
  }

  getEnvVar(name: string): string | undefined {
    return this.envVars.get(name) ?? process.env[name];
  }

  setEnvVar(name: string, value: string): void {
    this.envVars.set(name, value);
  }

  unsetEnvVar(name: string): void {
    this.envVars.delete(name);
  }

  getAllEnvVars(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    for (const [key, value] of this.envVars) {
      result[key] = value;
    }
    return result;
  }

  resolvePath(path: string): string {
    if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
      return normalizePath(path);
    }
    return normalizePath(`${this.workdir}/${path}`);
  }

  isPathSafe(path: string): boolean {
    const resolved = this.resolvePath(path);
    const normalizedWorkdir = normalizePath(this.workdir);
    return resolved.startsWith(normalizedWorkdir) || resolved.startsWith(normalizePath(process.cwd()));
  }

  protected getDefaultTimeout(toolName: string): number {
    for (const [category, timeout] of Object.entries(DEFAULT_TIMEOUTS)) {
      if (toolName.toLowerCase().includes(category)) {
        return timeout;
      }
    }
    return DEFAULT_TIMEOUTS.default;
  }

  protected getTimeoutOverride(action: Action): number | undefined {
    if (action.metadata?.timeoutMs) {
      return action.metadata.timeoutMs as number;
    }
    return undefined;
  }

  protected getMaxRetries(toolName: string): number {
    for (const [category, config] of Object.entries(RETRY_CONFIGS)) {
      if (toolName.toLowerCase().includes(category)) {
        return config.maxRetries;
      }
    }
    return RETRY_CONFIGS.default.maxRetries;
  }

  protected getRetryDelay(toolName: string): number {
    for (const [category, config] of Object.entries(RETRY_CONFIGS)) {
      if (toolName.toLowerCase().includes(category)) {
        return config.baseDelayMs;
      }
    }
    return RETRY_CONFIGS.default.baseDelayMs;
  }

  protected isRetryableError(error: string): boolean {
    const retryablePatterns = [
      "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EAGAIN",
      "EBUSY", "EPERM", "temporary", "timeout", "rate limit",
      "too many requests", "service unavailable", "502", "503", "504",
    ];

    const lowerError = error.toLowerCase();
    return retryablePatterns.some((pattern) =>
      lowerError.includes(pattern.toLowerCase()),
    );
  }

  protected getConcurrencyLimit(toolName: string): number {
    for (const [category, limit] of Object.entries(DEFAULT_CONCURRENCY_LIMITS)) {
      if (toolName.toLowerCase().includes(category)) {
        return limit;
      }
    }
    return DEFAULT_CONCURRENCY_LIMITS.default;
  }

  protected getRecoveryStrategy(toolName: string): {
    type: "retry" | "fallback" | "skip" | "error";
    maxRetries?: number;
    fallbackTool?: string;
  } {
    const lowerTool = toolName.toLowerCase();

    if (lowerTool.includes("network") || lowerTool.includes("fetch")) {
      return { type: "retry", maxRetries: 3 };
    }

    if (lowerTool.includes("file") || lowerTool.includes("bash")) {
      return { type: "retry", maxRetries: 1 };
    }

    return { type: "error" };
  }
}
