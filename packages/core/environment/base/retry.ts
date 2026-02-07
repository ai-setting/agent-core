/**
 * @fileoverview Retry mechanism utilities for handling transient failures.
 * Implements exponential backoff with jitter for resilient tool execution.
 */

/**
 * Configuration options for {@link RetryManager}.
 *
 * @example
 * ```typescript
 * const config: RetryConfig = {
 *   maxRetries: 3,
 *   baseDelayMs: 1000,
 *   maxDelayMs: 30000,
 *   backoffMultiplier: 2,
 *   jitter: true
 * };
 * ```
 */
export interface RetryConfig {
  /** Maximum number of retry attempts before giving up. */
  maxRetries: number;

  /** Base delay in milliseconds for exponential backoff. */
  baseDelayMs: number;

  /** Maximum delay cap in milliseconds. */
  maxDelayMs: number;

  /** Multiplier for exponential backoff calculation. */
  backoffMultiplier: number;

  /** Whether to apply random jitter to delay. */
  jitter: boolean;

  /** Set of error patterns that indicate retryable failures. */
  retryableErrors: Set<string>;
}

/**
 * Result of a retryable operation.
 *
 * @typeParam T - The expected successful result type
 */
export interface RetryResult<T> {
  /** Whether the operation succeeded. */
  success: boolean;

  /** The result if successful. */
  result?: T;

  /** The error message if failed. */
  error?: string;

  /** Total number of attempts made. */
  attempts: number;

  /** Total time spent in milliseconds. */
  totalTimeMs: number;
}

/**
 * Manages retry policies for transient failure handling.
 *
 * Implements exponential backoff with optional jitter to prevent
 * thundering herd problems while providing resilient failure recovery.
 *
 * @example
 * ```typescript
 * const manager = new RetryManager({
 *   maxRetries: 3,
 *   baseDelayMs: 1000,
 *   jitter: true
 * });
 *
 * manager.configure("network_call", { maxRetries: 5 });
 * ```
 */
export class RetryManager {
  /** Default maximum retry attempts. */
  private maxRetries: number;

  /** Base delay in milliseconds for backoff calculation. */
  private baseDelayMs: number;

  /** Maximum delay cap to prevent excessive waits. */
  private maxDelayMs: number;

  /** Multiplier applied to base delay per attempt. */
  private backoffMultiplier: number;

  /** Whether to apply random jitter to delays. */
  private jitter: boolean;

  /** Set of error patterns indicating retryable conditions. */
  private retryableErrors: Set<string>;

  /** Per-tool configuration overrides. */
  private overrides: Map<string, Partial<RetryConfig>>;

  /**
   * Creates a new RetryManager instance.
   *
   * @param config - Optional retry configuration
   */
  constructor(config?: Partial<RetryConfig>) {
    this.maxRetries = config?.maxRetries ?? 3;
    this.baseDelayMs = config?.baseDelayMs ?? 1000;
    this.maxDelayMs = config?.maxDelayMs ?? 30000;
    this.backoffMultiplier = config?.backoffMultiplier ?? 2;
    this.jitter = config?.jitter ?? true;
    this.retryableErrors = config?.retryableErrors ?? new Set([
      "ECONNRESET",
      "ETIMEDOUT",
      "ENOTFOUND",
      "ECONNREFUSED",
      "timeout",
      "temporary",
      "rate limit",
      "too many requests",
    ]);
    this.overrides = new Map();
  }

  /**
   * Gets the maximum retry attempts for a specific tool.
   *
   * @param toolName - The name of the tool
   * @returns Maximum number of retry attempts
   *
   * @example
   * ```typescript
   * const retries = manager.getMaxRetries("network_call");
   * // Returns: 5 (configured) or default (3)
   * ```
   */
  getMaxRetries(toolName: string): number {
    return this.overrides.get(toolName)?.maxRetries ?? this.maxRetries;
  }

  /**
   * Calculates the delay before the next retry attempt.
   *
   * Uses exponential backoff with optional jitter to spread out retry attempts
   * and avoid overwhelming the target service.
   *
   * @param toolName - The name of the tool
   * @param attempt - The current attempt number (0-indexed)
   * @returns Delay in milliseconds before next retry
   *
   * @example
   * ```typescript
   * // First retry: 1000ms
   * // Second retry: 2000ms
   * // Third retry: 4000ms (capped at maxDelayMs)
   * const delay = manager.getRetryDelay("api_call", 2);
   * ```
   */
  getRetryDelay(toolName: string, attempt: number): number {
    const baseDelay = this.overrides.get(toolName)?.baseDelayMs ?? this.baseDelayMs;
    const multiplier = this.overrides.get(toolName)?.backoffMultiplier ?? this.backoffMultiplier;
    let delay = baseDelay * Math.pow(multiplier, attempt);
    delay = Math.min(delay, this.overrides.get(toolName)?.maxDelayMs ?? this.maxDelayMs);

    if (this.overrides.get(toolName)?.jitter ?? this.jitter) {
      // Jitter: random value between 50% and 100% of delay
      // Prevents synchronized retry storms
      delay = delay * (0.5 + Math.random() * 0.5);
    }

    return Math.floor(delay);
  }

  /**
   * Determines if an error is retryable based on known error patterns.
   *
   * @param error - The error message to check
   * @returns True if the error matches a retryable pattern
   *
   * @example
   * ```typescript
   * manager.isRetryableError("Connection timeout"); // true
   * manager.isRetryableError("Invalid syntax"); // false
   * ```
   */
  isRetryableError(error: string): boolean {
    const lowerError = error.toLowerCase();
    return Array.from(this.retryableErrors).some((pattern) =>
      lowerError.includes(pattern.toLowerCase()),
    );
  }

  /**
   * Adds a new error pattern to the retryable set.
   *
   * @param pattern - The error pattern to match (case-insensitive)
   *
   * @example
   * ```typescript
   * manager.setRetryableError("service unavailable");
   * ```
   */
  setRetryableError(pattern: string): void {
    this.retryableErrors.add(pattern.toLowerCase());
  }

  /**
   * Removes an error pattern from the retryable set.
   *
   * @param pattern - The error pattern to remove
   * @returns True if the pattern was removed
   */
  removeRetryableError(pattern: string): boolean {
    return this.retryableErrors.delete(pattern.toLowerCase());
  }

  /**
   * Configures retry behavior for a specific tool.
   *
   * @param toolName - The name of the tool
   * @param config - Partial configuration to apply
   *
   * @example
   * ```typescript
   * manager.configure("database", {
   *   maxRetries: 5,
   *   baseDelayMs: 500
   * });
   * ```
   */
  configure(toolName: string, config: Partial<RetryConfig>): void {
    this.overrides.set(toolName, {
      ...this.overrides.get(toolName),
      ...config,
    });
  }

  /**
   * Clears all tool-specific configuration overrides.
   */
  clearOverrides(): void {
    this.overrides.clear();
  }

  /**
   * Creates a new RetryManager with default settings.
   *
   * @returns Default configured RetryManager
   *
   * @example
   * ```typescript
   * const manager = RetryManager.default();
   * ```
   */
  static default(): RetryManager {
    return new RetryManager();
  }
}

/**
 * Executes an async function with retry logic.
 *
 * Attempts the function multiple times with exponential backoff delays
 * for retryable errors, collecting detailed execution statistics.
 *
 * @typeParam T - The expected successful result type
 * @param fn - The async function to execute
 * @param retryManager - The retry manager instance
 * @param toolName - The tool name for configuration lookup
 * @returns A Promise resolving to the retry result
 *
 * @example
 * ```typescript
 * const result = await executeWithRetry(
 *   () => fetchData(),
 *   RetryManager.default(),
 *   "network_call"
 * );
 *
 * if (result.success) {
 *   console.log(`Got result in ${result.attempts} attempts`);
 * } else {
 *   console.error(`Failed after ${result.attempts}: ${result.error}`);
 * }
 * ```
 */
export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  retryManager: RetryManager,
  toolName: string,
): Promise<RetryResult<T>> {
  const startTime = Date.now();
  let lastError: Error | undefined;
  const maxRetries = retryManager.getMaxRetries(toolName);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return {
        success: true,
        result,
        attempts: attempt + 1,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error as Error;

      if (!retryManager.isRetryableError(lastError.message)) {
        return {
          success: false,
          error: lastError.message,
          attempts: attempt + 1,
          totalTimeMs: Date.now() - startTime,
        };
      }

      if (attempt < maxRetries) {
        const delay = retryManager.getRetryDelay(toolName, attempt);
        // Wait before retrying to avoid overwhelming the target
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return {
    success: false,
    error: lastError?.message,
    attempts: maxRetries + 1,
    totalTimeMs: Date.now() - startTime,
  };
}
