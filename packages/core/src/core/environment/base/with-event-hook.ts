/**
 * @fileoverview withEventHook - Higher-order function for method-level hooks.
 *
 * Similar to Python decorators: wraps a function and invokes before/after hooks
 * on each call. Supports both sync and async functions.
 *
 * @example
 * ```typescript
 * createSession = withEventHook(
 *   (options?: SessionCreateOptions) => Session.create(options),
 *   {
 *     after: (self, session) => self.emitSessionEvent?.({ type: "session.created", ... }),
 *   }
 * );
 * ```
 */

export interface EventHookContext<T extends (...args: any[]) => any> {
  /** Instance (this) when the method is called */
  self: any;
  /** Original function arguments */
  args: Parameters<T>;
  /** Return value (for after hook) */
  result?: Awaited<ReturnType<T>>;
}

export interface EventHook<T extends (...args: any[]) => any> {
  before?: (self: any, ...args: Parameters<T>) => void;
  after?: (self: any, result: Awaited<ReturnType<T>>, ...args: Parameters<T>) => void;
}

/**
 * Wraps a function with before/after hooks.
 * Hooks receive the instance (this) as first argument, allowing access to instance methods.
 *
 * @param fn - The original function to wrap
 * @param hook - Before and/or after hooks
 * @returns Wrapped function with same signature
 */
export function withEventHook<T extends (...args: any[]) => any>(
  fn: T,
  hook: EventHook<T>
): T {
  return (function (this: any, ...args: Parameters<T>) {
    hook.before?.(this, ...args);
    const result = fn.apply(this, args);
    if (result instanceof Promise) {
      return result.then((r) => {
        hook.after?.(this, r, ...args);
        return r;
      }) as ReturnType<T>;
    }
    hook.after?.(this, result, ...args);
    return result;
  }) as T;
}

/** Hook type for void-returning methods where inner fn may return extra info for the hook */
export interface EventHookVoid<TArgs extends any[], TInnerResult = void> {
  before?: (self: any, ...args: TArgs) => void;
  after?: (self: any, result: TInnerResult, ...args: TArgs) => void;
}

/**
 * Like withEventHook but for void-returning methods.
 * The inner function may return a value used only by the after hook (e.g. to know if delete succeeded).
 * The wrapped method always returns void.
 */
export function withEventHookVoid<TArgs extends any[], TInnerResult>(
  fn: (...args: TArgs) => TInnerResult | Promise<TInnerResult>,
  hook: EventHookVoid<TArgs, TInnerResult>
): (...args: TArgs) => void | Promise<void> {
  return function (this: any, ...args: TArgs) {
    hook.before?.(this, ...args);
    const result = fn.apply(this, args);
    if (result instanceof Promise) {
      return result.then((r) => {
        hook.after?.(this, r, ...args);
      });
    }
    hook.after?.(this, result, ...args);
  };
}
