/**
 * @fileoverview TUI Logger - 客户端专用日志
 * 
 * 日志自动写入: ~/.config/tong_work/logs/tui.log
 */

import { createLogger, LOG_DIR } from "../../utils/logger.js";

export const tuiLogger = createLogger("tui", "tui.log");
export const eventLogger = createLogger("tui:event", "tui.log");
export const renderLogger = createLogger("tui:render", "tui.log");

// 导出日志目录供测试使用
export { LOG_DIR };
