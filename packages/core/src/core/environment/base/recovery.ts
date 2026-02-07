/**
 * @fileoverview Error recovery utilities for implementing resilient tool execution.
 * Provides configurable recovery strategies including retry, fallback, and skip.
 */

/**
 * Type of error recovery strategy to apply.
 */
export type RecoveryStrategyType =
  /** Retry the operation with optional delay. */
  | "retry"
  /** Execute an alternative fallback tool. */
  | "fallback"
  /** Skip the operation and return a predefined value. */
  | "skip"
  /** Propagate the error immediately. */
  | "error";

/**
 * Configuration for error recovery behavior.
 */
export interface RecoveryStrategy {
  /** The type of recovery strategy to apply. */
  type: RecoveryStrategyType;

  /** Maximum retry attempts (for retry strategy). */
  maxRetries?: number;

  /** Alternative tool name to execute (for fallback strategy). */
  fallbackTool?: unknown;

  /** Predefined return value (for skip strategy). */
  fallbackValue?: unknown;

  /** Custom error handler function. */
  onError?: (error: Error, context: RecoveryContext) => Promise<RecoveryAction>;
}

/**
 * Context information passed to custom error handlers.
 */
export interface RecoveryContext {
  /** Name of the tool that failed. */
  toolName: string;

  /** Unique identifier for this execution attempt. */
  actionId: string;

  /** Current attempt number (1-indexed). */
  attempt: number;

  /** The error that was thrown. */
  error: Error;

  /** Original arguments passed to the tool. */
  originalArgs: Record<string, unknown>;
}

/**
 * Actions that can be taken in response to an error.
 */
export type RecoveryAction =
  /** Retry the operation. */
  | { action: "retry"; delayMs?: number }
  /** Execute a fallback tool. */
  | { action: "fallback"; toolName: string; args?: Record<string, unknown> }
  /** Skip and return a predefined value. */
  | { action: "skip"; value?: unknown }
  /** Propagate the error. */
  | { action: "error"; error: Error };

/**
 * Manages error recovery strategies for tool execution failures.
 *
 * Provides configurable recovery policies that can be applied per tool,
 * supporting retry with backoff, fallback execution, graceful skipping,
 * and custom error handling logic.
 *
 * @example
 * ```typescript
 * const recovery = new ErrorRecovery({
 *   defaultStrategy: { type: "retry", maxRetries: 3 }
 * });
 *
 * recovery.setStrategy("api_call", {
 *   type: "fallback",
 *   fallbackTool: "cached_response"
 * });
 *
 * const result = await recovery.executeWithRecovery(
 *   () => fetchData(),
 *   "api_call",
 *   "fetch_123",
 *   {}
 * );
 * ```
 */
export class ErrorRecovery {
  /** Per-tool recovery strategy overrides. */
  private strategies: Map<string, RecoveryStrategy>;

  /** Default strategy when no tool-specific override exists. */
  private defaultStrategy: RecoveryStrategy;

  /** Execution history for tracking failures. */
  private executionHistory: Map<string, Array<{ timestamp: number; success: boolean; error?: string }>>;

  /** Maximum history entries per action. */
  private maxHistorySize: number;

  /**
   * Creates a new ErrorRecovery instance.
   *
   * @param config - Optional configuration settings
   */
  constructor(config?: {
    defaultStrategy?: RecoveryStrategy;
    maxHistorySize?: number;
  }) {
    this.maxHistorySize = config?.maxHistorySize ?? 100;
    this.defaultStrategy = config?.defaultStrategy ?? { type: "error" };
    this.strategies = new Map();
    this.executionHistory = new Map();
  }

  /**
   * Sets a custom recovery strategy for a specific tool.
   *
   * @param toolName - The name of the tool
   * @param strategy - The recovery strategy to apply
   *
   * @example
   * ```typescript
   * recovery.setStrategy("database", {
   *   type: "fallback",
   *   fallbackTool: "cached_query"
   * });
   * ```
   */
  setStrategy(toolName: string, strategy: RecoveryStrategy): void {
    this.strategies.set(toolName, strategy);
  }

  /**
   * Gets the recovery strategy for a specific tool.
   *
   * @param toolName - The name of the tool
   * @returns The applicable recovery strategy
   */
  getStrategy(toolName: string): RecoveryStrategy {
    return this.strategies.get(toolName) ?? this.defaultStrategy;
  }

  /**
   * Removes a custom strategy for a tool.
   *
   * @param toolName - The name of the tool
   * @returns True if a strategy was removed
   */
  removeStrategy(toolName: string): boolean {
    return this.strategies.delete(toolName);
  }

  /**
   * Executes a function with error recovery.
   *
   * Applies the configured recovery strategy on failure, allowing for
   * automatic retry, fallback execution, or graceful degradation.
   *
   * @typeParam T - The expected successful result type
   * @param fn - The async function to execute
   * @param toolName - The tool name for strategy lookup
   * @param actionId - Unique identifier for this execution
   * @param originalArgs - Arguments passed to the original function
   * @returns Promise resolving to the function result
   * @throws The last error if all recovery attempts fail
   *
   * @example
   * ```typescript
   * const result = await recovery.executeWithRecovery(
   *   () => fetchUserData(userId),
   *   "api_call",
   *   `fetch_${userId}`,
   *   { userId }
   * );
   * ```
   */
  async executeWithRecovery<T>(
    fn: () => Promise<T>,
    toolName: string,
    actionId: string,
    originalArgs: Record<string, unknown>,
  ): Promise<T> {
    const strategy = this.getStrategy(toolName);
    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt < (strategy.maxRetries ?? 1)) {
      attempt++;

      try {
        const result = await fn();
        this.recordExecution(toolName, actionId, true);
        return result;
      } catch (error) {
        lastError = error as Error;
        this.recordExecution(toolName, actionId, false, lastError.message);

        const context: RecoveryContext = {
          toolName,
          actionId,
          attempt,
          error: lastError,
          originalArgs,
        };

        let recoveryAction: RecoveryAction;

        if (strategy.onError) {
          // Use custom error handler if provided
          recoveryAction = await strategy.onError(lastError, context);
        } else {
          // Fall back to configured strategy type
          if (strategy.type === "retry") {
            recoveryAction = { action: "retry" };
          } else if (strategy.type === "error") {
            recoveryAction = { action: "error", error: lastError };
          } else {
            // For fallback/skip, let the switch handle it
            recoveryAction = { action: strategy.type as RecoveryAction["action"] } as RecoveryAction;
          }
        }

        switch (recoveryAction.action) {
          case "retry":
            if (recoveryAction.delayMs) {
              await new Promise((resolve) => setTimeout(resolve, recoveryAction.delayMs));
            }
            // Continue to next iteration for retry
            continue;

          case "fallback":
            if (strategy.fallbackTool) {
              return this.executeFallback(
                strategy.fallbackTool as string,
                recoveryAction.args ?? originalArgs,
              );
            }
            break;

          case "skip":
            return recoveryAction.value as T;

          case "error":
            throw lastError;
        }

        break;
      }
    }

    throw lastError;
  }

  /**
   * Executes a fallback tool (stub for subclass implementation).
   *
   * @typeParam T - The expected result type
   * @param fallbackToolName - Name of the fallback tool
   * @param args - Arguments for the fallback
   * @returns Promise resolving to fallback result
   * @throws Error indicating fallback not implemented
   */
  protected async executeFallback<T>(
    fallbackToolName: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    throw new Error(`Fallback execution not implemented: ${fallbackToolName}`);
  }

  /**
   * Records an execution attempt in history.
   *
   * @param toolName - The tool name
   * @param actionId - Unique action identifier
   * @param success - Whether the execution succeeded
   * @param error - Error message if failed
   */
  private recordExecution(
    toolName: string,
    actionId: string,
    success: boolean,
    error?: string,
  ): void {
    const key = `${toolName}:${actionId}`;
    const history = this.executionHistory.get(key) ?? [];
    history.push({ timestamp: Date.now(), success, error });
    if (history.length > this.maxHistorySize) {
      history.shift();
    }
    this.executionHistory.set(key, history);
  }

  /**
   * Gets execution history for a specific action.
   *
   * @param toolName - The tool name
   * @param actionId - Unique action identifier
   * @returns Array of execution attempts
   */
  getExecutionHistory(toolName: string, actionId: string): Array<{ timestamp: number; success: boolean; error?: string }> {
    return this.executionHistory.get(`${toolName}:${actionId}`) ?? [];
  }

  /**
   * Counts recent failures within a time window.
   *
   * @param toolName - The tool name
   * @param windowMs - Time window in milliseconds
   * @returns Number of failures within the window
   */
  getRecentFailures(toolName: string, windowMs: number = 60000): number {
    const now = Date.now();
    let failures = 0;

    for (const [key, history] of this.executionHistory) {
      if (key.startsWith(`${toolName}:`)) {
        for (const entry of history) {
          if (now - entry.timestamp < windowMs && !entry.success) {
            failures++;
          }
        }
      }
    }

    return failures;
  }

  /** Clears all execution history. */
  clear(): void {
    this.executionHistory.clear();
  }

  /**
   * Creates an ErrorRecovery with default error-first strategy.
   *
   * @returns ErrorRecovery that propagates errors immediately
   */
  static default(): ErrorRecovery {
    return new ErrorRecovery({
      defaultStrategy: { type: "error" },
    });
  }

  /**
   * Creates an ErrorRecovery with automatic fallback strategy.
   *
   * @param fallbackTool - Tool name to use as fallback
   * @returns ErrorRecovery configured with fallback
   */
  static withFallback(fallbackTool: string): ErrorRecovery {
    return new ErrorRecovery({
      defaultStrategy: { type: "fallback", fallbackTool },
    });
  }

  /**
   * Creates an ErrorRecovery with automatic retry strategy.
   *
   * @param maxRetries - Maximum retry attempts
   * @returns ErrorRecovery configured for retries
   */
  static withRetry(maxRetries: number = 3): ErrorRecovery {
    return new ErrorRecovery({
      defaultStrategy: { type: "retry", maxRetries },
    });
  }
}
