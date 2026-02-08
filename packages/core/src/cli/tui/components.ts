/**
 * @fileoverview SolidJS TUI Components - 纯函数版本（无 JSX）
 * 
 * 参考 OpenCode 设计，但使用纯字符串渲染
 */

import type { Message, MessagePart } from "./types";

// ANSI 颜色辅助函数
const color = {
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  gray: (text: string) => `\x1b[90m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
};

const style = {
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
  italic: (text: string) => `\x1b[3m${text}\x1b[23m`,
  dim: (text: string) => `\x1b[2m${text}\x1b[22m`,
};

const border = {
  split: "▌",
};

/**
 * 文本换行工具
 */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  for (const para of paragraphs) {
    if (para.length <= width) {
      lines.push(para);
    } else {
      let remaining = para;
      while (remaining.length > width) {
        lines.push(remaining.slice(0, width));
        remaining = remaining.slice(width);
      }
      if (remaining) lines.push(remaining);
    }
  }

  return lines;
}

/**
 * 渲染用户消息
 */
export function renderUserMessage(message: Message, width: number): string {
  const lines = wrapText(message.content, width - 6);
  let output = "";

  output += `  ${color.green(border.split)}\n`;
  for (const line of lines) {
    output += `  ${color.green(border.split)} ${line}\n`;
  }
  output += `  ${color.green(border.split)}\n`;

  return output;
}

/**
 * 渲染系统消息
 */
export function renderSystemMessage(message: Message, width: number): string {
  const lines = wrapText(message.content, width - 6);
  let output = "";

  for (const line of lines) {
    output += `  ${color.gray("• " + line)}\n`;
  }

  return output;
}

/**
 * 渲染单个 Part
 */
export function renderPart(part: MessagePart, width: number): string {
  switch (part.type) {
    case "reasoning":
      return renderReasoningPart(part, width);
    case "text":
      return renderTextPart(part, width);
    case "tool_call":
      return renderToolCallPart(part);
    case "tool_result":
      return renderToolResultPart(part);
    default:
      return "";
  }
}

/**
 * 渲染推理过程
 */
function renderReasoningPart(part: MessagePart, width: number): string {
  const text = part.content || "";
  if (!text.trim()) return "";

  const lines = wrapText(`Thinking: ${text}`, width - 10);
  let output = "";

  for (const line of lines) {
    output += `  ${color.gray(border.split)} ${style.italic(color.gray(line))}\n`;
  }

  return output;
}

/**
 * 渲染文本内容
 */
function renderTextPart(part: MessagePart, width: number): string {
  const text = part.content || "";
  if (!text.trim()) return "";

  const lines = wrapText(text, width - 6);
  let output = "";

  for (const line of lines) {
    output += `     ${line}\n`;
  }

  return output;
}

/**
 * 渲染工具调用
 */
function renderToolCallPart(part: MessagePart): string {
  const toolName = part.toolName || "tool";
  const args = part.toolArgs ? JSON.stringify(part.toolArgs).slice(0, 50) : "";

  let output = `     ${color.yellow(`⚡ ${toolName}`)}`;
  if (args) output += ` ${color.gray(args)}`;
  return output + "\n";
}

/**
 * 渲染工具结果
 */
function renderToolResultPart(part: MessagePart): string {
  const toolName = part.toolName || "tool";
  const success = part.success !== false;
  const icon = success ? "✓" : "✗";
  const iconColor = success ? color.green : color.red;

  let resultStr = "";
  if (part.result !== undefined) {
    resultStr =
      typeof part.result === "string"
        ? part.result
        : JSON.stringify(part.result);
    resultStr = resultStr.slice(0, 80);
  }

  let output = `     ${iconColor(icon + " " + toolName)}`;
  if (resultStr) output += ` ${color.gray(resultStr)}`;
  return output + "\n";
}
