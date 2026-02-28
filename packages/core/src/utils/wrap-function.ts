import { getSpanCollector, SpanCollector } from "./span-collector.js";
import { createLogger } from "./logger.js";

export interface TracedOptions {
  name?: string;
  recordParams?: boolean;
  recordResult?: boolean;
  recordError?: boolean;
  log?: boolean;
  maxLogSize?: number;
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
  }
): T {
  const collector = getSpanCollector();
  const shouldLog = options?.log ?? false;
  const maxLogSize = options?.maxLogSize ?? 500;

  const truncate = (obj: any): any => {
    if (obj === undefined) return undefined;
    const str = typeof obj === "string" ? obj : JSON.stringify(obj);
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
    const str = typeof obj === "string" ? obj : JSON.stringify(obj);
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

  if (!collector) {
    return fn;
  }

  return ((...args: any[]) => {
    const attributes: Record<string, any> = {};

    if (options?.recordParams !== false) {
      attributes["params"] = truncate(args);
    }

    logFn("enter", args);

    const context = collector.startSpan(name, attributes);

    try {
      const result = fn(...args);

      if (result instanceof Promise) {
        return result.then((resolved) => {
          collector.endSpan(context, options?.recordResult ? truncate(resolved) : undefined);
          logFn("quit", options?.recordResult ? resolved : undefined);
          return resolved;
        }).catch((error) => {
          collector.endSpan(context, undefined, error as Error);
          logFn("error", (error as Error).message);
          throw error;
        });
      }

      collector.endSpan(context, options?.recordResult ? truncate(result) : undefined);
      logFn("quit", options?.recordResult ? result : undefined);
      return result;

    } catch (error) {
      collector.endSpan(context, undefined, error as Error);
      logFn("error", (error as Error).message);
      throw error;
    }
  }) as T;
}
