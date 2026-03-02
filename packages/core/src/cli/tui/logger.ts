/**
 * @fileoverview TUI Logger - 客户端专用日志
 * 
 * 日志自动写入: $XDG_DATA_HOME/tong_work/logs/tui.log (默认 ~/.local/share/tong_work/logs/tui.log)
 * 支持通过 logging.path 配置自定义日志目录
 */

import { createLogger, getLogDir } from "../../utils/logger.js";

function createTuiLogger(module: string): ReturnType<typeof createLogger> {
  return createLogger(module, "tui.log");
}

let tuiLoggerInstance: ReturnType<typeof createLogger> | null = null;
let eventLoggerInstance: ReturnType<typeof createLogger> | null = null;
let renderLoggerInstance: ReturnType<typeof createLogger> | null = null;

export const tuiLogger = {
  info(message: string, data?: unknown) {
    if (!tuiLoggerInstance) tuiLoggerInstance = createTuiLogger("tui");
    tuiLoggerInstance.info(message, data);
  },
  warn(message: string, data?: unknown) {
    if (!tuiLoggerInstance) tuiLoggerInstance = createTuiLogger("tui");
    tuiLoggerInstance.warn(message, data);
  },
  error(message: string, data?: unknown) {
    if (!tuiLoggerInstance) tuiLoggerInstance = createTuiLogger("tui");
    tuiLoggerInstance.error(message, data);
  },
  debug(message: string, data?: unknown) {
    if (!tuiLoggerInstance) tuiLoggerInstance = createTuiLogger("tui");
    tuiLoggerInstance.debug(message, data);
  },
};

export const eventLogger = {
  debug(message: string, data?: unknown) {
    if (!eventLoggerInstance) eventLoggerInstance = createTuiLogger("tui:event");
    eventLoggerInstance.debug(message, data);
  },
};

export const renderLogger = {
  debug(message: string, data?: unknown) {
    if (!renderLoggerInstance) renderLoggerInstance = createTuiLogger("tui:render");
    renderLoggerInstance.debug(message, data);
  },
};

// 导出日志目录供测试使用
export { getLogDir as LOG_DIR };
