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

  // 获取调用 wrapFunction 的原函数的位置（独立函数，放到 logFn 外部）
  const getCallerLocation = (): string => {
    const originalLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 15;
    const err = new Error();
    Error.captureStackTrace(err, getCallerLocation);
    const stack = err.stack?.split("\n") || [];
    Error.stackTraceLimit = originalLimit;

    // 找到调用 wrapFunction 的位置（跳过 wrap-function.ts 内部和 logFn 本身）
    for (let i = 1; i < stack.length; i++) {
      const line = stack[i];
      // 跳过 wrap-function.ts 内部和 logFn 本身
      if (line.includes("wrap-function.ts") || line.includes("logFn") || line.includes("getCallerLocation")) continue;
      const match = line.match(/at\s+.+\s+\((.+):(\d+):\d+\)/) || line.match(/at\s+(.+):(\d+):\d+/);
      if (match) {
        const filePath = match[1];
        // 跳过 native 等非文件路径
        if (!filePath || filePath === "native") {
          continue;
        }
        // 转换为相对路径
        const normalizedPath = filePath.replace(/\\/g, "/");
        let relativePath = normalizedPath;
        const rootMarkers = ["packages/core/src", "packages/core", "packages"];
        for (const marker of rootMarkers) {
          const idx = normalizedPath.indexOf(marker);
          if (idx !== -1) {
            relativePath = normalizedPath.substring(idx);
            break;
          }
        }
        return `${relativePath}:${match[2]}`;
      }
    }
    return "";
  };

  const logFn = (event: "enter" | "quit" | "error", argsOrData?: any, callerLocation?: string) => {
    if (!shouldLog) return;
    const logger = createLogger("traced:" + name, "server.log");

    const tag = event === "enter" ? ">>>" : event === "quit" ? "<<<" : "!!!";
    const prefix = `${TRACE_LOG_PREFIX} ${tag} ${name}`;

    // 如果已传入 callerLocation（从 enter 时缓存），直接使用
    // 否则在 error 时重新获取
    const originalFnLocation = callerLocation || getCallerLocation();

    const logMessage = (msg: string, data?: any) => {
      if (data !== undefined) {
        logger.debug(`${prefix} ${msg}: ${truncateString(data)}`, { callerLocation: originalFnLocation });
      } else {
        logger.debug(`${prefix} ${msg}`, { callerLocation: originalFnLocation });
      }
    };

    if (event === "enter") {
      logMessage("enter", argsOrData);
    } else if (event === "quit") {
      logMessage("quit", options?.recordResult ? argsOrData : undefined);
    } else {
      logMessage("error", argsOrData);
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

    // 在 enter 时获取调用位置并保存，quit 时复用同一位置
    const callerLocation = getCallerLocation();
    logFn("enter", args, callerLocation);

    const context = currentCollector.startSpan(name, attributes);

    try {
      const result = fn.call(this, ...args);

      if (result instanceof Promise) {
        return result.then((resolved) => {
          currentCollector.endSpan(context, options?.recordResult ? truncate(resolved) : undefined);
          logFn("quit", options?.recordResult ? resolved : undefined, callerLocation);
          return resolved;
        }).catch((error) => {
          currentCollector.endSpan(context, undefined, error as Error);
          logFn("error", (error as Error).message, callerLocation);
          throw error;
        });
      }

      currentCollector.endSpan(context, options?.recordResult ? truncate(result) : undefined);
      logFn("quit", options?.recordResult ? result : undefined, callerLocation);
      return result;

    } catch (error) {
      currentCollector.endSpan(context, undefined, error as Error);
      logFn("error", (error as Error).message, callerLocation);
      throw error;
    }
  } as T;
}
