import { getSpanCollector, SpanCollector } from "./span-collector.js";
import { createLogger } from "./logger.js";

export interface TracedOptions {
  name?: string;
  recordParams?: boolean;
  recordResult?: boolean;
  recordError?: boolean;
  log?: boolean;
  maxLogSize?: number;
  paramFilter?: (args: any[], argNames?: string[]) => Record<string, any>;
}

export function Traced(options?: TracedOptions) {
  return function <T extends (...args: any[]) => any>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ) {
    const originalFn = descriptor.value!;
    const spanName = options?.name || propertyKey;

    descriptor.value = wrapFunction(originalFn, spanName, {
      recordParams: options?.recordParams ?? true,
      recordResult: options?.recordResult ?? false,
      recordError: options?.recordError ?? true,
      log: options?.log ?? false,
      maxLogSize: options?.maxLogSize ?? 500,
      paramFilter: options?.paramFilter,
    }) as T;

    return descriptor;
  };
}

export function TracedAs(name: string, options?: Omit<TracedOptions, "name">) {
  return Traced({ name, ...options });
}

export function TracedLightweight(options?: { log?: boolean; maxLogSize?: number }) {
  return Traced({ recordParams: false, recordResult: false, log: options?.log ?? false, maxLogSize: options?.maxLogSize });
}

export function wrapFunction<T extends (...args: any[]) => any>(
  fn: T,
  name: string,
  options?: {
    recordParams?: boolean;
    recordResult?: boolean;
    recordError?: boolean;
    log?: boolean;
    maxLogSize?: number;
    paramFilter?: (args: any[], argNames?: string[]) => Record<string, any>;
  }
): T {
  const collector = getSpanCollector();
  const shouldLog = options?.log ?? false;
  const maxLogSize = options?.maxLogSize ?? 500;

  const truncate = (obj: any): any => {
    if (obj === undefined) return undefined;
    const str = typeof obj === "string" ? obj : JSON.stringify(obj, null, 0).replace(/\n/g, "");
    if (str.length > maxLogSize) {
      return str.slice(0, maxLogSize) + " [TRUNCATED]";
    }
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  };

  const truncateString = (obj: any): string => {
    if (obj === undefined) return "";
    const str = typeof obj === "string" ? obj : JSON.stringify(obj, null, 0).replace(/\n/g, "");
    return str.length > maxLogSize ? str.slice(0, maxLogSize) + " [TRUNCATED]" : str;
  };

  const TRACE_LOG_PREFIX = "[TRACE]";

  const logFn = (event: "enter" | "quit" | "error", data?: any) => {
    if (!shouldLog) return;
    const logger = createLogger("traced:" + name, "server.log");

    const tag = event === "enter" ? ">>>" : event === "quit" ? "<<<" : "!!!";
    const prefix = `${TRACE_LOG_PREFIX} ${tag} ${name}`;

    if (data !== undefined) {
      logger.info(`${prefix} ${event}: ${truncateString(data)}`);
    } else {
      logger.info(`${prefix} ${event}`);
    }
  };

  // Always wrap the function, but check collector at call time to support late initialization
  return function(this: any, ...args: any[]) {
    const currentCollector = getSpanCollector();
    if (!currentCollector) {
      return fn.call(this, ...args);
    }

    const attributes: Record<string, any> = {};

    if (options?.recordParams !== false) {
      if (options?.paramFilter) {
        attributes["params"] = truncate(options.paramFilter(args));
      } else {
        attributes["params"] = truncate(args);
      }
    }

    logFn("enter", args);

    const context = currentCollector.startSpan(name, attributes);

    try {
      const result = fn.call(this, ...args);

      if (result instanceof Promise) {
        return result.then((resolved) => {
          currentCollector.endSpan(context, options?.recordResult ? truncate(resolved) : undefined);
          logFn("quit", options?.recordResult ? resolved : undefined);
          return resolved;
        }).catch((error) => {
          currentCollector.endSpan(context, undefined, error as Error);
          logFn("error", (error as Error).message);
          throw error;
        });
      }

      currentCollector.endSpan(context, options?.recordResult ? truncate(result) : undefined);
      logFn("quit", options?.recordResult ? result : undefined);
      return result;

    } catch (error) {
      currentCollector.endSpan(context, undefined, error as Error);
      logFn("error", (error as Error).message);
      throw error;
    }
  } as T;
}
