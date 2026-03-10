/**
 * @fileoverview Server Logger - 服务端专用日志
 * 
 * 日志自动写入: $XDG_DATA_HOME/tong_work/logs/server.log (默认 ~/.local/share/tong_work/logs/server.log)
 */

import { createLogger, type LogLevel } from "../utils/logger.js";

// 从环境变量获取日志级别
const logLevel = (process.env.LOG_LEVEL as LogLevel) || undefined;

// 服务端各模块 logger，分别写入不同文件
export const serverLogger = createLogger("server", "server.log", logLevel);
export const sseLogger = createLogger("sse", "server.log", logLevel);
export const busLogger = createLogger("bus", "server.log", logLevel);
export const sessionLogger = createLogger("session", "server.log", logLevel);
