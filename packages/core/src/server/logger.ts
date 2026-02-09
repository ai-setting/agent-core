/**
 * @fileoverview Server Logger - 服务端专用日志
 * 
 * 日志自动写入: ~/.config/tong_work/logs/server.log
 */

import { createLogger } from "../utils/logger.js";

// 服务端各模块 logger，分别写入不同文件
export const serverLogger = createLogger("server", "server.log");
export const sseLogger = createLogger("sse", "server.log");
export const busLogger = createLogger("bus", "server.log");
export const sessionLogger = createLogger("session", "server.log");
