/**
 * @fileoverview Timeout management utilities for tool execution.
 * Provides configurable timeout policies with per-tool overrides.
 */

/**
 * Configuration options for {@link TimeoutManager}.
 *
 * @example
 * ```typescript
 * const config: TimeoutConfig = {
 *   defaultTimeoutMs: 60000,
 *   overrides: new Map([["bash", 30000]])
 * };
 * ```
 */
export interface TimeoutConfig {
  /**
   * Default timeout in milliseconds for tools without specific overrides.
   * @default 60000
   */
  defaultTimeoutMs: number;

  /**
   * Map of tool-specific timeout overrides.
   */
  overrides: Map<string, number>;
}

/**
 * Result of a timed operation.
 */
export interface TimeoutResult {
  /** Whether the operation timed out. */
  timedOut: boolean;

  /** Total elapsed time in milliseconds. */
  elapsedMs: number;
}

/**
 * Manages execution timeouts for tool invocations.
 *
 * Provides configurable timeout policies with per-tool overrides,
 * supporting both default and custom timeout durations.
 *
 * @example
 * ```typescript
 * const manager = new TimeoutManager({ defaultTimeoutMs: 30000 });
 * manager.setTimeout("bash", 60000);
 * ```
 */
export class TimeoutManager {
  /** Default timeout in milliseconds applied to tools without specific overrides. */
  private defaultTimeoutMs: number;

  /** Map of tool-specific timeout overrides keyed by tool name. */
  private overrides: Map<string, number>;

  /**
   * Creates a new TimeoutManager instance.
   *
   * @param config - Optional configuration options
   */
  constructor(config?: Partial<TimeoutConfig>) {
    this.defaultTimeoutMs = config?.defaultTimeoutMs ?? 60000;
    this.overrides = config?.overrides ?? new Map();
  }

  /**
   * Retrieves the timeout duration for a specific tool.
   *
   * @param toolName - The name of the tool
   * @param action - Optional action metadata that may influence timeout
   * @returns The timeout duration in milliseconds
   *
   * @example
   * ```typescript
   * const timeout = manager.getTimeout("bash");
   * // Returns: 60000 (default) or tool-specific override
   * ```
   */
  getTimeout(toolName: string, action?: { metadata?: Record<string, unknown> }): number {
    return this.overrides.get(toolName) ?? this.defaultTimeoutMs;
  }

  /**
   * Sets a custom timeout for a specific tool.
   *
   * @param toolName - The name of the tool
   * @param timeoutMs - Timeout duration in milliseconds
   *
   * @example
   * ```typescript
   * manager.setTimeout("bash", 30000);
   * manager.setTimeout("read", 10000);
   * ```
   */
  setTimeout(toolName: string, timeoutMs: number): void {
    this.overrides.set(toolName, timeoutMs);
  }

  /**
   * Removes a custom timeout override for a tool.
   *
   * @param toolName - The name of the tool
   * @returns True if an override was removed, false if none existed
   */
  removeTimeout(toolName: string): boolean {
    return this.overrides.delete(toolName);
  }

  /**
   * Clears all tool-specific timeout overrides.
   *
   * After calling this, all tools will use the default timeout.
   */
  clearOverrides(): void {
    this.overrides.clear();
  }

  /**
   * Creates a new TimeoutManager with default settings.
   *
   * @returns A new TimeoutManager instance with 60-second default timeout
   *
   * @example
   * ```typescript
   * const manager = TimeoutManager.default();
   * ```
   */
  static default(): TimeoutManager {
    return new TimeoutManager();
  }
}

/**
 * Creates a timeout controller for managing async operation timeouts.
 *
 * Provides a timer and cleanup function that can be used to implement
 * timeout behavior with proper resource cleanup.
 *
 * @param timeoutMs - Duration in milliseconds before timeout
 * @param abortSignal - Optional AbortSignal for external cancellation
 * @returns Object containing timer and abort handler
 *
 * @example
 * ```typescript
 * const { timer, abortHandler } = createTimeoutController(5000, signal);
 * // Cleanup when done
 * abortHandler();
 * ```
 */
export function createTimeoutController(
  timeoutMs: number,
  abortSignal?: AbortSignal,
): { timer: ReturnType<typeof setTimeout>; abortHandler: () => void } {
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
  }, timeoutMs);

  const abortHandler = () => {
    if (!timedOut) {
      clearTimeout(timer);
    }
  };

  if (abortSignal) {
    abortSignal.addEventListener("abort", abortHandler);
  }

  return { timer, abortHandler };
}

/**
 * Executes an async function with a timeout constraint.
 *
 * If the function completes within the timeout, its result is returned.
 * If the timeout is exceeded, the function is cancelled and an error is thrown.
 *
 * @typeParam T - The return type of the async function
 * @param fn - The async function to execute
 * @param timeoutMs - Maximum duration in milliseconds
 * @param abortSignal - Optional AbortSignal for external cancellation
 * @returns A Promise resolving to the function's result
 * @throws Error if the operation times out or is aborted
 *
 * @example
 * ```typescript
 * const result = await executeWithTimeout(
 *   () => fetchData(),
 *   5000
 * );
 * ```
 */
export function executeWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const { timer, abortHandler } = createTimeoutController(timeoutMs, abortSignal);

    Promise.resolve(fn())
      .then((result) => {
        clearTimeout(timer);
        if (abortSignal) {
          abortSignal.removeEventListener("abort", abortHandler);
        }
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        if (abortSignal) {
          abortSignal.removeEventListener("abort", abortHandler);
        }
        reject(error);
      });
  });
}
