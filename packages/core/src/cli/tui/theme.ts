/**
 * @fileoverview 主题配置
 * 
 * 定义 TUI 颜色主题
 */

export interface Theme {
  // 文本颜色
  text: string;
  textMuted: string;
  textDim: string;
  
  // 边框颜色
  border: string;
  borderActive: string;
  
  // 背景颜色
  background: string;
  backgroundPanel: string;
  backgroundElement: string;
  
  // 强调色
  accent: string;
  primary: string;
  secondary: string;
  
  // 状态颜色
  success: string;
  warning: string;
  error: string;
  
  // 差异颜色
  diffAdded: string;
  diffRemoved: string;
}

// 默认暗色主题
export const defaultTheme: Theme = {
  text: "\x1b[37m",           // 白色
  textMuted: "\x1b[90m",      // 灰色
  textDim: "\x1b[2m",         // 暗淡
  
  border: "\x1b[38;5;240m",   // 深灰边框
  borderActive: "\x1b[36m",   // 青色激活边框
  
  background: "\x1b[40m",     // 黑色背景
  backgroundPanel: "\x1b[48;5;235m",  // 面板背景
  backgroundElement: "\x1b[48;5;238m", // 元素背景
  
  accent: "\x1b[33m",         // 黄色强调
  primary: "\x1b[34m",        // 蓝色主色
  secondary: "\x1b[35m",      // 紫色次色
  
  success: "\x1b[32m",        // 绿色成功
  warning: "\x1b[33m",        // 黄色警告
  error: "\x1b[31m",          // 红色错误
  
  diffAdded: "\x1b[32m",      // 绿色添加
  diffRemoved: "\x1b[31m",    // 红色删除
};

// ANSI 重置码
export const RESET = "\x1b[0m";

// 样式帮助函数
export const style = {
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[22m`,
  italic: (text: string) => `\x1b[3m${text}\x1b[23m`,
  underline: (text: string) => `\x1b[4m${text}\x1b[24m`,
  strikethrough: (text: string) => `\x1b[9m${text}\x1b[29m`,
};

// 颜色帮助函数
export const color = {
  black: (text: string) => `\x1b[30m${text}${RESET}`,
  red: (text: string) => `\x1b[31m${text}${RESET}`,
  green: (text: string) => `\x1b[32m${text}${RESET}`,
  yellow: (text: string) => `\x1b[33m${text}${RESET}`,
  blue: (text: string) => `\x1b[34m${text}${RESET}`,
  magenta: (text: string) => `\x1b[35m${text}${RESET}`,
  cyan: (text: string) => `\x1b[36m${text}${RESET}`,
  white: (text: string) => `\x1b[37m${text}${RESET}`,
  gray: (text: string) => `\x1b[90m${text}${RESET}`,
};

// 边框字符
export const border = {
  horizontal: "─",
  vertical: "│",
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  leftT: "├",
  rightT: "┤",
  topT: "┬",
  bottomT: "┴",
  cross: "┼",
};

// 自定义边框字符（OpenCode 风格）
export const splitBorder = {
  vertical: "▌",
  customBorderChars: {
    left: "▌",
    right: "▐",
  },
};
