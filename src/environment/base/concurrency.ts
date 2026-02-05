/**
 * @fileoverview Concurrency control utilities for managing parallel tool execution.
 * Implements a semaphore-based pattern with wait queues for controlled parallelism.
 */

/**
 * Configuration options for {@link ConcurrencyManager}.
 */
export interface ConcurrencyConfig {
  /** Default maximum concurrent operations. */
  defaultLimit: number;

  /** Tool-specific concurrency limit overrides. */
  overrides: Map<string, number>;

  /** Wait queues for pending operations keyed by tool name. */
  waitQueue: Map<string, Array<{ resolve: () => void; reject: (error: Error) => void }>>;
}

/**
 * Result of a slot acquisition attempt.
 */
export interface ConcurrencyResult {
  /** Whether a slot was successfully acquired. */
  acquired: boolean;

  /** Time spent waiting in milliseconds (0 if acquired immediately). */
  waitTimeMs: number;

  /** Unique identifier for the acquired slot. */
  slotId?: number;
}

/**
 * Manages concurrent execution limits using a semaphore-based pattern.
 *
 * Controls the number of simultaneous operations for each tool type,
 * queuing excess requests when limits are reached. Supports configurable
 * per-tool limits with automatic wait queue management.
 *
 * @example
 * ```typescript
 * const manager = new ConcurrencyManager({ defaultLimit: 5 });
 * manager.setConcurrencyLimit("file_ops", 3);
 *
 * const slot = await manager.acquireSlot("file_ops");
 * if (slot.acquired) {
 *   try {
 *     await performFileOperation();
 *   } finally {
 *     manager.releaseSlot("file_ops", slot.slotId!);
 *   }
 * }
 * ```
 */
export class ConcurrencyManager {
  /** Default maximum concurrent operations per tool. */
  private defaultLimit: number;

  /** Per-tool concurrency limit overrides. */
  private overrides: Map<string, number>;

  /** Currently active slot IDs for each tool. */
  private activeSlots: Map<string, Set<number>>;

  /** Next available slot ID for each tool. */
  private nextSlotId: Map<string, number>;

  /** Wait queues for pending slot acquisitions keyed by tool name. */
  private waitQueue: Map<string, Array<{ resolve: (value: void) => void; reject: (error: Error) => void }>>;

  /** Maximum time to wait for a slot in milliseconds. */
  private maxWaitTimeMs: number;

  /**
   * Creates a new ConcurrencyManager instance.
   *
   * @param config - Optional configuration settings
   */
  constructor(config?: { defaultLimit?: number; maxWaitTimeMs?: number }) {
    this.defaultLimit = config?.defaultLimit ?? 10;
    this.maxWaitTimeMs = config?.maxWaitTimeMs ?? 30000;
    this.overrides = new Map();
    this.activeSlots = new Map();
    this.nextSlotId = new Map();
    this.waitQueue = new Map();
  }

  /**
   * Gets the concurrency limit for a specific tool.
   *
   * @param toolName - The name of the tool
   * @returns The maximum number of concurrent operations allowed
   *
   * @example
   * ```typescript
   * const limit = manager.getConcurrencyLimit("bash");
   * // Returns: 5 (configured) or default (10)
   * ```
   */
  getConcurrencyLimit(toolName: string): number {
    return this.overrides.get(toolName) ?? this.defaultLimit;
  }

  /**
   * Sets a custom concurrency limit for a specific tool.
   *
   * @param toolName - The name of the tool
   * @param limit - Maximum concurrent operations (minimum 1)
   *
   * @example
   * ```typescript
   * manager.setConcurrencyLimit("api_calls", 3);
   * manager.setConcurrencyLimit("file_ops", 5);
   * ```
   */
  setConcurrencyLimit(toolName: string, limit: number): void {
    this.overrides.set(toolName, Math.max(1, limit));
  }

  /**
   * Removes a custom concurrency limit override for a tool.
   *
   * @param toolName - The name of the tool
   * @returns True if an override was removed
   */
  removeConcurrencyLimit(toolName: string): boolean {
    return this.overrides.delete(toolName);
  }

  /**
   * Acquires a concurrency slot for a specific tool.
   *
   * If a slot is available, returns immediately. If all slots are in use,
   * waits in a queue until a slot becomes available or timeout expires.
   *
   * @param toolName - The name of the tool
   * @returns Promise resolving to the acquisition result
   *
   * @example
   * ```typescript
   * const result = await manager.acquireSlot("network_call");
   * if (result.acquired) {
   *   console.log(`Acquired slot ${result.slotId} after ${result.waitTimeMs}ms`);
   * }
   * ```
   */
  async acquireSlot(toolName: string): Promise<ConcurrencyResult> {
    const limit = this.getConcurrencyLimit(toolName);

    if (!this.activeSlots.has(toolName)) {
      this.activeSlots.set(toolName, new Set());
      this.nextSlotId.set(toolName, 1);
      this.waitQueue.set(toolName, []);
    }

    const active = this.activeSlots.get(toolName)!;

    if (active.size < limit) {
      // Slot available - acquire immediately
      const slotId = this.nextSlotId.get(toolName)!;
      active.add(slotId);
      this.nextSlotId.set(toolName, slotId + 1);
      return { acquired: true, waitTimeMs: 0, slotId };
    }

    // All slots in use - wait in queue
    const queue = this.waitQueue.get(toolName)!;
    let rejectFn: (error: Error) => void;

    const waitPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        // Remove this waiter from the queue on timeout
        const idx = queue.findIndex((item) => item.resolve === resolve);
        if (idx !== -1) {
          queue.splice(idx, 1);
        }
        reject(new Error(`Concurrency limit wait timeout for tool: ${toolName}`));
      }, this.maxWaitTimeMs);

      rejectFn = (error: Error) => {
        clearTimeout(timeout);
        reject(error);
      };

      queue.push({ resolve, reject: rejectFn });
    });

    const startTime = Date.now();
    await waitPromise;

    // Slot acquired - assign ID and return
    const slotId = this.nextSlotId.get(toolName)!;
    active.add(slotId);
    this.nextSlotId.set(toolName, slotId + 1);

    return { acquired: true, waitTimeMs: Date.now() - startTime, slotId };
  }

  /**
   * Releases a concurrency slot for a specific tool.
   *
   * Must be called once for each successful acquireSlot() to maintain
   * accurate slot counts. If a queue exists, the next waiter is notified.
   *
   * @param toolName - The name of the tool
   * @param slotId - The ID of the slot to release
   *
   * @example
   * ```typescript
   * manager.releaseSlot("network_call", 3);
   * ```
   */
  releaseSlot(toolName: string, slotId: number): void {
    const active = this.activeSlots.get(toolName);
    if (active) {
      active.delete(slotId);

      if (active.size === 0) {
        this.activeSlots.delete(toolName);
      }
    }

    const queue = this.waitQueue.get(toolName);
    if (queue && queue.length > 0) {
      // Notify next waiter
      const { resolve } = queue.shift()!;
      resolve();
    } else if (!this.activeSlots.has(toolName)) {
      // Cleanup if no active slots and no queue
      this.waitQueue.delete(toolName);
      this.nextSlotId.delete(toolName);
    }
  }

  /**
   * Gets the current number of active slots for a tool.
   *
   * @param toolName - The name of the tool
   * @returns Number of currently active operations
   */
  getActiveCount(toolName: string): number {
    return this.activeSlots.get(toolName)?.size ?? 0;
  }

  /**
   * Gets the current wait queue length for a tool.
   *
   * @param toolName - The name of the tool
   * @returns Number of operations waiting for a slot
   */
  getWaitQueueLength(toolName: string): number {
    return this.waitQueue.get(toolName)?.length ?? 0;
  }

  /**
   * Clears all state and rejects pending waiters.
   *
   * Use with caution - this will cause all pending acquireSlot()
   * calls to reject with an error.
   */
  clear(): void {
    for (const queue of this.waitQueue.values()) {
      for (const { reject } of queue) {
        reject(new Error("Concurrency manager cleared"));
      }
    }
    this.overrides.clear();
    this.activeSlots.clear();
    this.nextSlotId.clear();
    this.waitQueue.clear();
  }

  /**
   * Creates a new ConcurrencyManager with default settings.
   *
   * @returns Default configured ConcurrencyManager
   *
   * @example
   * ```typescript
   * const manager = ConcurrencyManager.default();
   * ```
   */
  static default(): ConcurrencyManager {
    return new ConcurrencyManager();
  }
}

/**
 * Executes an async function with concurrency control.
 *
 * A convenience wrapper that acquires a slot before execution and
 * releases it afterward, even if the function throws.
 *
 * @typeParam T - The return type of the async function
 * @param fn - The async function to execute
 * @param manager - The concurrency manager instance
 * @param toolName - The tool name for limit lookup
 * @returns Promise resolving to the function's result
 * @throws Error if slot cannot be acquired
 *
 * @example
 * ```typescript
 * const result = await withConcurrency(
 *   () => performExpensiveOperation(),
 *   ConcurrencyManager.default(),
 *   "expensive_ops"
 * );
 * ```
 */
export async function withConcurrency<T>(
  fn: () => Promise<T>,
  manager: ConcurrencyManager,
  toolName: string,
): Promise<T> {
  const result = await manager.acquireSlot(toolName);

  if (!result.acquired) {
    throw new Error(`Failed to acquire concurrency slot for tool: ${toolName}`);
  }

  try {
    return await fn();
  } finally {
    if (result.slotId !== undefined) {
      manager.releaseSlot(toolName, result.slotId);
    }
  }
}
