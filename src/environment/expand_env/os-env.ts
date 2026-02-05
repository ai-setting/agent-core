/**
 * @fileoverview Operating system environment implementation.
 * Provides concrete OS-specific tool execution and environment management.
 */

import { z } from "zod";
import { BaseEnvironment } from "../base/base-environment.js";
import {
  Context,
  Action,
  ToolResult,
  Tool,
  ToolInfo,
  LLMStreamEvent,
  StreamHandler,
  ToolContext,
} from "../../types/index.js";
import { TimeoutManager, RetryManager, ConcurrencyManager } from "../base/index.js";
import { ToolRegistration } from "../base/base-environment.js";

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

/**
 * Default timeouts for different tool categories.
 */
const DEFAULT_TIMEOUTS: Record<string, number> = {
  bash: 60000,
  file_read: 10000,
  file_write: 10000,
  file_glob: 5000,
  file_grep: 10000,
  network_fetch: 30000,
  default: 30000,
};

/**
 * Default concurrency limits for different tool categories.
 */
const DEFAULT_CONCURRENCY_LIMITS: Record<string, number> = {
  bash: 4,
  file_read: 10,
  file_write: 5,
  file_glob: 10,
  file_grep: 10,
  network_fetch: 5,
  default: 10,
};

/**
 * Retry configuration for different error types.
 */
const RETRY_CONFIGS: Record<string, { maxRetries: number; baseDelayMs: number }> = {
  network: { maxRetries: 3, baseDelayMs: 1000 },
  file: { maxRetries: 2, baseDelayMs: 500 },
  bash: { maxRetries: 1, baseDelayMs: 1000 },
  default: { maxRetries: 2, baseDelayMs: 500 },
};

/**
 * Operating system environment for agent tool execution.
 *
 * Provides OS-specific implementations for:
 * - Process management (bash commands)
 * - File system operations (read, write, glob, grep)
 * - Environment variable management
 * - Working directory handling
 *
 * @example
 * ```typescript
 * // Simplified usage - auto-configures LLM and registers all OS tools
 * const env = new OsEnv({
 *   model: "openai/gpt-4o",
 *   workdir: "/home/user/project",
 *   defaultBashTimeoutMs: 120000
 * });
 *
 * await env.handle_query("list files in current directory", context);
 * ```
 *
 * @example
 * ```typescript
 * // Legacy usage - manually register tools
 * const env = new OsEnv({
 *   workdir: "/home/user/project"
 * });
 *
 * env.registerTool(createBashTool());
 * env.registerTool(createFileTools());
 *
 * await env.handle_query("list files", context);
 * ```
 */
export class OsEnv extends BaseEnvironment {
  /** Working directory for command execution. */
  private workdir: string;

  /** Environment variables. */
  private envVars: Map<string, string>;

  /** Process spawning configuration. */
  private processConfig: {
    maxBuffer: number;
    encoding: BufferEncoding;
    shell: string;
  };

  /**
   * Creates a new OsEnv instance.
   *
   * @param config - Optional OS environment configuration
   *
   * @example
   * ```typescript
   * // Auto-load from environment variables
   * const env = new OsEnv();
   * await env.handle_query("hello", context);
   * ```
   *
   * @example
   * ```typescript
   * // Explicit configuration
   * const env = new OsEnv({
   *   model: "openai/gpt-4o",
   *   apiKey: "sk-xxx",
   *   workdir: "/home/user/project"
   * });
   *
   * await env.handle_query("list files", context);
   * ```
   */
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
      maxBuffer: 10 * 1024 * 1024, // 10MB
      encoding: "utf-8",
      shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
    };

    this.configureDefaults();
    this.registerDefaultTools();

    const model = config?.model ?? process.env.LLM_MODEL;
    const apiKey = config?.apiKey ?? process.env.LLM_API_KEY;
    const baseURL = config?.baseURL ?? process.env.LLM_BASE_URL;

    if (model) {
      this.configureLLMWithModel(model, baseURL, apiKey);
    }
  }

  /**
   * Creates an OsEnv instance with automatic environment variable loading.
   * Loads LLM_MODEL, LLM_API_KEY, and LLM_BASE_URL from environment.
   *
   * @returns A new OsEnv instance configured from environment
   *
   * @example
   * ```typescript
   * const env = await OsEnv.create();
   * await env.handle_query("hello", context);
   * ```
   */
  static async create(): Promise<OsEnv> {
    const model = process.env.LLM_MODEL;
    const apiKey = process.env.LLM_API_KEY;
    const baseURL = process.env.LLM_BASE_URL;

    return new OsEnv({ model, apiKey, baseURL });
  }

  private registerDefaultTools(): void {
    const tools = createOsTools();
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * Configures default timeouts and concurrency limits.
   */
  private configureDefaults(): void {
    const timeoutManager = new TimeoutManager({
      defaultTimeoutMs: DEFAULT_TIMEOUTS.default,
    });

    const retryManager = new RetryManager({
      maxRetries: RETRY_CONFIGS.default.maxRetries,
      baseDelayMs: RETRY_CONFIGS.default.baseDelayMs,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
      jitter: true,
    });

    const concurrencyManager = new ConcurrencyManager({
      defaultLimit: DEFAULT_CONCURRENCY_LIMITS.default,
      maxWaitTimeMs: 60000,
    });

    this.timeoutManager = timeoutManager;
    this.retryManager = retryManager;
    this.concurrencyManager = concurrencyManager;
  }

  /**
   * Gets the working directory.
   *
   * @returns Current working directory
   */
  getWorkdir(): string {
    return this.workdir;
  }

  /**
   * Sets the working directory.
   *
   * @param path - New working directory path
   */
  setWorkdir(path: string): void {
    this.workdir = path;
  }

  /**
   * Gets an environment variable.
   *
   * @param name - Variable name
   * @returns Variable value or undefined
   */
  getEnvVar(name: string): string | undefined {
    return this.envVars.get(name) ?? process.env[name];
  }

  /**
   * Sets an environment variable.
   *
   * @param name - Variable name
   * @param value - Variable value
   */
  setEnvVar(name: string, value: string): void {
    this.envVars.set(name, value);
  }

  /**
   * Unsets an environment variable.
   *
   * @param name - Variable name
   */
  unsetEnvVar(name: string): void {
    this.envVars.delete(name);
  }

  /**
   * Gets all environment variables.
   *
   * @returns Object with all environment variables
   */
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

  /**
   * Resolves a path relative to the working directory.
   *
   * @param path - Path to resolve
   * @returns Resolved absolute path
   */
  resolvePath(path: string): string {
    if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) {
      return path;
    }
    return `${this.workdir}/${path}`;
  }

  /**
   * Checks if a path is within the working directory.
   *
   * @param path - Path to check
   * @returns True if path is within workdir
   */
  isPathSafe(path: string): boolean {
    const resolved = this.resolvePath(path);
    return resolved.startsWith(this.workdir);
  }

  // Abstract method implementations

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
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
      "ECONNREFUSED",
      "EAGAIN",
      "EBUSY",
      "EPERM",
      "temporary",
      "timeout",
      "rate limit",
      "too many requests",
      "service unavailable",
      "502",
      "503",
      "504",
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

/**
 * Bash command result type.
 */
export interface BashResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  duration: number;
}

/**
 * Executes a bash command.
 *
 * @param command - Command to execute
 * @param options - Execution options
 * @returns Promise resolving to command result
 */
export async function bash(
  command: string,
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    maxBuffer?: number;
  },
): Promise<BashResult> {
  const startTime = Date.now();
  const timeout = options?.timeout ?? 60000;
  const maxBuffer = options?.maxBuffer ?? 10 * 1024 * 1024;

  return new Promise((resolve) => {
    const child = require("child_process").exec(
      command,
      {
        cwd: options?.cwd ?? process.cwd(),
        env: { ...process.env, ...options?.env },
        encoding: "utf-8",
        maxBuffer,
        timeout: Math.floor(timeout / 1000),
        shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
        killSignal: "SIGTERM",
      },
      (error: Error | null, stdout: string, stderr: string) => {
        const duration = Date.now() - startTime;

        if (error) {
          if ((error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
            resolve({
              success: false,
              stdout,
              stderr,
              exitCode: null,
              signal: "SIGTERM",
              duration,
            });
            return;
          }

          resolve({
            success: false,
            stdout,
            stderr,
            exitCode: (error as NodeJS.ErrnoException).code === "ENOENT" ? 127 : 1,
            signal: null,
            duration,
          });
          return;
        }

        resolve({
          success: true,
          stdout,
          stderr,
          exitCode: 0,
          signal: null,
          duration,
        });
      },
    );

    if (timeout > 0) {
      setTimeout(() => {
        child.kill("SIGTERM");
      }, timeout);
    }
  });
}

/**
 * File read options.
 */
export interface ReadFileOptions {
  encoding?: BufferEncoding;
  maxSize?: number;
}

/**
 * Reads a file asynchronously.
 *
 * @param path - File path to read
 * @param options - Reading options
 * @returns Promise resolving to file contents
 */
export async function readFile(
  path: string,
  options?: ReadFileOptions,
): Promise<string> {
  const fs = await import("fs/promises");
  const encoding = options?.encoding ?? "utf-8";
  const maxSize = options?.maxSize ?? 1024 * 1024; // 1MB default max

  const stat = await fs.stat(path);
  if (stat.size > maxSize) {
    throw new Error(`File too large: ${stat.size} bytes (max: ${maxSize})`);
  }

  return fs.readFile(path, { encoding });
}

/**
 * File write options.
 */
export interface WriteFileOptions {
  encoding?: BufferEncoding;
  append?: boolean;
  createDirectories?: boolean;
}

/**
 * Writes to a file asynchronously.
 *
 * @param path - File path to write
 * @param content - Content to write
 * @param options - Writing options
 * @returns Promise resolving when complete
 */
export async function writeFile(
  path: string,
  content: string,
  options?: WriteFileOptions,
): Promise<void> {
  const fs = await import("fs/promises");
  const encoding = options?.encoding ?? "utf-8";

  if (options?.createDirectories) {
    const dir = require("path").dirname(path);
    await fs.mkdir(dir, { recursive: true });
  }

  if (options?.append) {
    await fs.appendFile(path, content, encoding);
  } else {
    await fs.writeFile(path, content, encoding);
  }
}

/**
 * File glob options.
 */
export interface GlobOptions {
  cwd?: string;
  pattern?: string;
  maxResults?: number;
}

/**
 * Finds files matching a pattern.
 *
 * @param patterns - Glob patterns to match
 * @param options - Search options
 * @returns Promise resolving to matching file paths
 */
export async function glob(
  patterns: string | string[],
  options?: GlobOptions,
): Promise<string[]> {
  const globModule = await import("glob");
  const globSync = globModule.globSync;
  const cwd = options?.cwd ?? process.cwd();
  const maxResults = options?.maxResults ?? 1000;

  const patternArray = Array.isArray(patterns) ? patterns : [patterns];

  const results: Set<string> = new Set();

  for (const pattern of patternArray) {
    const matches = globSync(pattern, {
      cwd,
      absolute: true,
      nodir: true,
      ignore: ["node_modules/**", ".git/**"],
    });

    for (const match of matches) {
      if (results.size < maxResults) {
        results.add(match);
      }
    }
  }

  return Array.from(results).slice(0, maxResults);
}

/**
 * File grep options.
 */
export interface GrepOptions {
  cwd?: string;
  pattern?: string;
  maxMatches?: number;
  caseSensitive?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
}

/**
 * Searches for text in files.
 *
 * @param patterns - Search patterns
 * @param options - Search options
 * @returns Promise resolving to matching lines
 */
export async function grep(
  patterns: string | RegExp | (string | RegExp)[],
  options?: GrepOptions,
): Promise<Array<{ file: string; line: number; content: string }>> {
  const fs = await import("fs/promises");
  const path = await import("path");

  const cwd = options?.cwd ?? process.cwd();
  const maxMatches = options?.maxMatches ?? 100;
  const caseSensitive = options?.caseSensitive ?? true;

  const searchRegexes = (Array.isArray(patterns) ? patterns : [patterns]).map((p) =>
    p instanceof RegExp ? p : new RegExp(p, caseSensitive ? "g" : "gi"),
  );

  const results: Array<{ file: string; line: number; content: string }> = [];

  const files = await glob(options?.includePatterns ?? ["**/*"], {
    cwd,
    maxResults: 500,
  });

  for (const file of files) {
    if (results.length >= maxMatches) break;

    const skipFile = options?.excludePatterns?.some((pattern) => {
      const regex = new RegExp(pattern);
      return regex.test(file);
    });

    if (skipFile) continue;

    try {
      const content = await readFile(file, { maxSize: 1024 * 1024 });
      const lines = content.split("\n");

      for (let i = 0; i < lines.length && results.length < maxMatches; i++) {
        const line = lines[i];

        for (const regex of searchRegexes) {
          regex.lastIndex = 0;
          if (regex.test(line)) {
            results.push({
              file: path.relative(cwd, file),
              line: i + 1,
              content: line.trim(),
            });
            break;
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}

/**
 * Creates the bash tool for OsEnv.
 *
 * @returns ToolInfo for bash execution
 */
export function createBashTool(): ToolInfo {
  return {
    name: "bash",
    description: "Execute bash commands in the working directory",
    parameters: z.object({
      command: z.string().describe("The bash command to execute"),
      timeoutMs: z
        .number()
        .optional()
        .describe("Timeout in milliseconds (default: 60000)"),
      workdir: z.string().optional().describe("Working directory"),
    }),
    execute: async (args) => {
      const result = await bash(args.command, {
        cwd: args.workdir,
        timeout: args.timeoutMs,
      });

      return {
        success: result.success,
        output: result.stdout || result.stderr,
        error: result.success ? undefined : `Exit ${result.exitCode}: ${result.stderr}`,
      };
    },
  };
}

/**
 * Creates file operation tools for OsEnv.
 *
 * @returns Array of ToolInfo for file operations
 */
export function createFileTools(): ToolInfo[] {
  return [
    {
      name: "read_file",
      description: "Read the contents of a file",
      parameters: z.object({
        path: z.string().describe("Path to the file to read"),
        encoding: z
          .string()
          .optional()
          .describe("File encoding (default: utf-8)"),
      }),
      execute: async (args) => {
        try {
          const content = await readFile(args.path, {
            encoding: (args.encoding as BufferEncoding) ?? "utf-8",
          });
          return {
            success: true,
            output: content,
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            error: `Failed to read file: ${(error as Error).message}`,
          };
        }
      },
    },
    {
      name: "write_file",
      description: "Write content to a file",
      parameters: z.object({
        path: z.string().describe("Path to the file to write"),
        content: z.string().describe("Content to write to the file"),
        append: z.boolean().optional().describe("Append to file instead of overwrite"),
        createDirs: z
          .boolean()
          .optional()
          .describe("Create parent directories if they don't exist"),
      }),
      execute: async (args) => {
        try {
          await writeFile(args.path, args.content, {
            append: args.append,
            createDirectories: args.createDirs,
          });
          return {
            success: true,
            output: `Wrote ${args.content.length} bytes to ${args.path}`,
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            error: `Failed to write file: ${(error as Error).message}`,
          };
        }
      },
    },
    {
      name: "glob",
      description: "Find files matching a glob pattern",
      parameters: z.object({
        patterns: z.union([z.string(), z.array(z.string())]).describe("Glob patterns"),
        cwd: z.string().optional().describe("Working directory to search in"),
        maxResults: z.number().optional().describe("Maximum results (default: 100)"),
      }),
      execute: async (args) => {
        try {
          const results = await glob(args.patterns, {
            cwd: args.cwd,
            maxResults: args.maxResults ?? 100,
          });
          return {
            success: true,
            output: results.join("\n"),
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            error: `Failed to glob: ${(error as Error).message}`,
          };
        }
      },
    },
    {
      name: "grep",
      description: "Search for text patterns in files",
      parameters: z.object({
        patterns: z
          .union([z.string(), z.array(z.string())])
          .describe("Search patterns (string or regex)"),
        cwd: z.string().optional().describe("Working directory to search in"),
        maxMatches: z.number().optional().describe("Maximum matches (default: 100)"),
        caseSensitive: z
          .boolean()
          .optional()
          .describe("Case sensitive search (default: true)"),
        include: z
          .array(z.string())
          .optional()
          .describe("File patterns to include"),
        exclude: z
          .array(z.string())
          .optional()
          .describe("File patterns to exclude"),
      }),
      execute: async (args) => {
        try {
          const results = await grep(args.patterns, {
            cwd: args.cwd,
            maxMatches: args.maxMatches ?? 100,
            caseSensitive: args.caseSensitive,
            includePatterns: args.include,
            excludePatterns: args.exclude,
          });

          const output = results
            .map((r) => `${r.file}:${r.line}: ${r.content}`)
            .join("\n");

          return {
            success: true,
            output,
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            error: `Failed to grep: ${(error as Error).message}`,
          };
        }
      },
    },
  ];
}

/**
 * Creates all OS environment tools.
 *
 * @returns Array of all OS tools
 */
export function createOsTools(): ToolInfo[] {
  return [createBashTool(), ...createFileTools()];
}
