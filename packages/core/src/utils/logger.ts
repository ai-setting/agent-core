/**
 * @fileoverview Logger - 统一日志系统
 * 
 * 遵循 XDG Base Directory Specification:
 * - 日志存储在 XDG_DATA_HOME/tong_work/logs/ (默认 ~/.local/share/tong_work/logs/)
 * 无需配置，自动创建目录
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { xdgData } from "xdg-basedir";

export type LogLevel = "debug" | "info" | "warn" | "error";

// XDG 标准数据目录: XDG_DATA_HOME/tong_work/logs/ (默认 ~/.local/share/tong_work/logs/)
const LOG_DIR = join(xdgData || "", "tong_work", "logs");

interface LoggerConfig {
  level?: LogLevel;
  prefix?: string;
  filename?: string; // 日志文件名，如 "server.log", "tui.log"
}

class Logger {
  private level: LogLevel;
  private prefix: string;
  private filename: string;
  private logFile: string;

  private readonly levelPriority: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(config: LoggerConfig = {}) {
    this.level = config.level || (process.env.LOG_LEVEL as LogLevel) || "info";
    this.prefix = config.prefix || "";
    this.filename = config.filename || "app.log";
    this.logFile = join(LOG_DIR, this.filename);

    // 确保日志目录存在
    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    if (!existsSync(LOG_DIR)) {
      try {
        mkdirSync(LOG_DIR, { recursive: true });
      } catch (err) {
        console.error("[Logger] Failed to create log directory:", LOG_DIR, err);
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return this.levelPriority[level] >= this.levelPriority[this.level];
  }

  private formatMessage(level: LogLevel, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const prefix = this.prefix ? `[${this.prefix}]` : "";
    let formatted = `${timestamp} [${level.toUpperCase()}]${prefix} ${message}`;
    
    if (data !== undefined) {
      if (typeof data === "object") {
        formatted += " " + JSON.stringify(data, null, 2);
      } else {
        formatted += " " + String(data);
      }
    }
    
    return formatted;
  }

  private writeToFile(formattedMessage: string): void {
    try {
      // 确保目录存在
      if (!existsSync(LOG_DIR)) {
        mkdirSync(LOG_DIR, { recursive: true });
      }
      appendFileSync(this.logFile, formattedMessage + "\n");
    } catch (err) {
      console.error("[Logger] Write failed:", this.logFile, err);
    }
  }

  debug(message: string, data?: unknown): void {
    if (!this.shouldLog("debug")) return;
    const formatted = this.formatMessage("debug", message, data);
    console.debug(formatted);
    this.writeToFile(formatted);
  }

  info(message: string, data?: unknown): void {
    if (!this.shouldLog("info")) return;
    const formatted = this.formatMessage("info", message, data);
    console.log(formatted);
    this.writeToFile(formatted);
  }

  warn(message: string, data?: unknown): void {
    if (!this.shouldLog("warn")) return;
    const formatted = this.formatMessage("warn", message, data);
    console.warn(formatted);
    this.writeToFile(formatted);
  }

  error(message: string, data?: unknown): void {
    if (!this.shouldLog("error")) return;
    const formatted = this.formatMessage("error", message, data);
    console.error(formatted);
    this.writeToFile(formatted);
  }

  // 创建带前缀的子 logger
  child(prefix: string): Logger {
    return new Logger({
      level: this.level,
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
export function createLogger(module: string, filename?: string): Logger {
  return new Logger({ 
    filename: filename || `${module}.log`,
    prefix: module 
  });
}

// 导出日志目录路径
export { LOG_DIR };

export { Logger };
