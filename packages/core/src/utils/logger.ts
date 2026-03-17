/**
 * @fileoverview Logger - 统一日志系统
 * 
 * 遵循 XDG Base Directory Specification:
 * - 日志存储在 XDG_DATA_HOME/tong_work/logs/ (默认 ~/.local/share/tong_work/logs/)
 * 无需配置，自动创建目录
 * 
 * 支持 requestId 追踪：通过 trace-context 模块自动注入
 * 
 * 安静模式：通过 setQuietMode(true) 启用，此时日志只写入文件，不输出到 stdout/stderr
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { basename, dirname, join } from "path";
import { xdgData } from "xdg-basedir";
import { getTraceContext } from "./trace-context.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

// 日志目录优先级：环境变量 LOG_DIR > 配置 (通过 setLogDirOverride) > XDG 默认
let logDirOverride: string | null = null;

// 安静模式：启用后日志只写入文件，不输出到 stdout/stderr
let quietMode = false;

export function setQuietMode(enabled: boolean): void {
  quietMode = enabled;
}

export function isQuietMode(): boolean {
  return quietMode;
}

// XDG 标准数据目录: XDG_DATA_HOME/tong_work/logs/ (默认 ~/.local/share/tong_work/logs/)
const DEFAULT_LOG_DIR = join(xdgData || "", "tong_work", "logs");

function getLogDir(): string {
  return process.env.LOG_DIR || logDirOverride || DEFAULT_LOG_DIR;
}

export function setLogDirOverride(path: string): void {
  logDirOverride = path;
}

interface LoggerConfig {
  level?: LogLevel;
  prefix?: string;
  filename?: string; // 日志文件名，如 "server.log", "tui.log"
}

class Logger {
  private static _globalLevel: LogLevel | null = null;
  
  private level: LogLevel;
  private prefix: string;
  private filename: string;
  private currentLogDir: string = "";

  static setGlobalLevel(level: LogLevel): void {
    Logger._globalLevel = level;
  }
  
  static get globalLevel(): LogLevel | null {
    return Logger._globalLevel;
  }

  private getEffectiveLevel(): LogLevel {
    return Logger._globalLevel || this.level;
  }

  private get logFile(): string {
    const dir = getLogDir();
    if (dir !== this.currentLogDir) {
      this.currentLogDir = dir;
      this.ensureLogDirectory();
    }
    return join(this.currentLogDir, this.filename);
  }

  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(config: LoggerConfig = {}) {
    // 优先使用全局级别（通过 setGlobalLevel 设置），其次使用构造函数参数，最后使用环境变量
    const envLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
    this.level = Logger.globalLevel || config.level || envLevel;
    this.prefix = config.prefix || "";
    this.filename = config.filename || "app.log";
    this.currentLogDir = getLogDir();

    // 确保日志目录存在
    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    if (!existsSync(getLogDir())) {
      try {
        mkdirSync(getLogDir(), { recursive: true });
      } catch (err) {
        console.error("[Logger] Failed to create log directory:", getLogDir(), err);
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.getEffectiveLevel()];
  }

  private getCallerLocation(): { file: string; line: number } | null {
    const originalLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 10;
    
    const err = new Error();
    Error.captureStackTrace(err, this.formatMessage);
    
    const stack = err.stack?.split("\n") || [];
    Error.stackTraceLimit = originalLimit;

    for (let i = 1; i < stack.length; i++) {
      const line = stack[i];
      if (line.includes("at ") && !line.includes("logger.ts") && !line.includes("formatMessage")) {
        const match = line.match(/at\s+.+\s+\((.+):(\d+):\d+\)/) || line.match(/at\s+(.+):(\d+):\d+/);
        if (match) {
          const filePath = match[1];
          const relativePath = this.getRelativePath(filePath);
          return {
            file: relativePath,
            line: parseInt(match[2], 10),
          };
        }
      }
    }
    return null;
  }

  private getRelativePath(fullPath: string): string {
    const normalizedPath = fullPath.replace(/\\/g, "/");
    
    const rootMarkers = [
      "packages/core/src",
      "packages/core",
      "packages",
    ];
    
    for (const marker of rootMarkers) {
      const idx = normalizedPath.indexOf(marker);
      if (idx !== -1) {
        return normalizedPath.substring(idx);
      }
    }
    
    return normalizedPath;
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const now = new Date();
    const timestamp = now.toLocaleString("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).replace(/\//g, "-") + "." + String(now.getMilliseconds()).padStart(3, "0");
    const prefix = this.prefix ? `[${this.prefix}]` : "";
    
    const trace = getTraceContext();
    const requestId = trace.getRequestId();
    const requestIdStr = requestId ? `[requestId=${requestId}]` : "";

    // 检查 data 中是否包含 callerLocation（用于 traced 装饰器传递原函数位置）
    let locationStr = "";
    if (data && typeof data === "object" && "callerLocation" in data) {
      locationStr = data.callerLocation as string;
      // 从 data 中移除 callerLocation，避免它在日志中显示
      const { callerLocation, ...rest } = data as any;
      data = Object.keys(rest).length > 0 ? rest : undefined;
    } else {
      const location = this.getCallerLocation();
      locationStr = location ? `${location.file}:${location.line}` : "";
    }
    
    let formatted = `${timestamp} [${level.toUpperCase()}]${requestIdStr}${locationStr ? ` [${locationStr}]` : ""}${prefix} ${message}`;
    
    if (data !== undefined) {
      if (typeof data === "object") {
        // 使用单行 JSON 格式，避免换行
        formatted += " " + JSON.stringify(data).replace(/\n/g, "");
      } else {
        formatted += " " + String(data);
      }
    }
    
    return formatted;
  }

  private writeToFile(formattedMessage: string): void {
    try {
      // 确保目录存在
      if (!existsSync(getLogDir())) {
        mkdirSync(getLogDir(), { recursive: true });
      }
      appendFileSync(this.logFile, formattedMessage + "\n");
    } catch (err) {
      console.error("[Logger] Write failed:", this.logFile, err);
    }
  }

  debug(message: string, data?: unknown): void {
    if (!this.shouldLog("debug")) return;
    const formatted = this.formatMessage("debug", message, data);
    if (!quietMode) {
      console.debug(formatted);
    }
    this.writeToFile(formatted);
  }

  info(message: string, data?: unknown): void {
    if (!this.shouldLog("info")) return;
    const formatted = this.formatMessage("info", message, data);
    if (!quietMode) {
      console.log(formatted);
    }
    this.writeToFile(formatted);
  }

  warn(message: string, data?: unknown): void {
    if (!this.shouldLog("warn")) return;
    const formatted = this.formatMessage("warn", message, data);
    if (!quietMode) {
      console.warn(formatted);
    }
    this.writeToFile(formatted);
  }

  error(message: string, data?: unknown): void {
    if (!this.shouldLog("error")) return;
    const formatted = this.formatMessage("error", message, data);
    if (!quietMode) {
      console.error(formatted);
    }
    this.writeToFile(formatted);
  }

  // 创建带前缀的子 logger
  child(prefix: string): Logger {
    return new Logger({
      level: this.getEffectiveLevel(),
      filename: this.filename,
      prefix: this.prefix ? `${this.prefix}:${prefix}` : prefix,
    });
  }

  // 获取日志文件路径
  getLogFile(): string {
    return this.logFile;
  }
}

// 默认 logger 实例
export const logger = new Logger({ filename: "app.log" });

// 创建特定模块的 logger
export function createLogger(module: string, filename?: string, level?: LogLevel): Logger {
  // 优先使用传入的 level，其次使用全局 level
  const effectiveLevel = level || Logger.globalLevel || undefined;
  return new Logger({ 
    filename: filename || `${module}.log`,
    prefix: module,
    level: effectiveLevel
  });
}

// 设置全局日志级别（在配置加载后调用）
export function setLoggerGlobalLevel(level: LogLevel): void {
  Logger.setGlobalLevel(level);
}

// 导出日志目录路径
export { DEFAULT_LOG_DIR, getLogDir };

// 导出 LOG_DIR 供外部使用
export const LOG_DIR = DEFAULT_LOG_DIR;

export { Logger };
