/**
 * @fileoverview SolidJS-based TUI Renderer
 * 
 * 使用 SolidJS 响应式系统实现无闪烁渲染
 */

import { createEffect, createSignal } from "solid-js";
import { stdin, stdout } from "process";
import readline from "readline";
import { store, storeActions } from "./store";
import { renderUserMessage, renderSystemMessage, renderPart, wrapText } from "./components";
import type { TUIOptions } from "./types";

// ANSI 控制码
const ANSI = {
  CLEAR: "\x1b[2J\x1b[H",
  RESET: "\x1b[0m",
  HIDE_CURSOR: "\x1b[?25l",
  SHOW_CURSOR: "\x1b[?25h",
  SAVE_CURSOR: "\x1b[s",
  RESTORE_CURSOR: "\x1b[u",
  CLEAR_LINE: "\x1b[K",
  UP: (n: number) => `\x1b[${n}A`,
  DOWN: (n: number) => `\x1b[${n}B`,
  GOTO: (row: number, col: number) => `\x1b[${row};${col}H`,
};

// 颜色
const color = {
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  gray: (text: string) => `\x1b[90m${text}\x1b[0m`,
};

const border = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  leftT: "├",
  rightT: "┤",
};

export class SolidTUIRenderer {
  private rl: readline.Interface;
  private width = stdout.columns || 80;
  private height = stdout.rows || 24;
  private inputBuffer = "";
  private onSubmit?: (text: string) => void;
  private cleanupFns: Array<() => void> = [];
  private renderCount = 0;
  private mounted = false;

  constructor() {
    this.rl = readline.createInterface({
      input: stdin,
      output: stdout,
      terminal: true,
    });

    this.setupInput();
    this.setupResize();
  }

  private setupInput() {
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");

    const handler = (key: string) => {
      // Ctrl+C
      if (key === "\x03") {
        this.cleanup();
        process.exit(0);
      }

      // Ctrl+L
      if (key === "\x0c") {
        this.fullRender();
        return;
      }

      // Enter
      if (key === "\r" || key === "\n") {
        if (this.inputBuffer.trim()) {
          this.onSubmit?.(this.inputBuffer);
          this.inputBuffer = "";
          this.render();
        }
        return;
      }

      // Backspace
      if (key === "\x7f") {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        this.render();
        return;
      }

      // 忽略控制字符
      if (key.charCodeAt(0) < 32) return;

      // 普通字符
      this.inputBuffer += key;
      this.render();
    };

    stdin.on("data", handler);
    this.cleanupFns.push(() => stdin.off("data", handler));
  }

  private setupResize() {
    const handler = () => {
      this.width = stdout.columns || 80;
      this.height = stdout.rows || 24;
      this.fullRender();
    };

    process.stdout.on("resize", handler);
    this.cleanupFns.push(() => process.stdout.off("resize", handler));
  }

  setOnSubmit(callback: (text: string) => void) {
    this.onSubmit = callback;
  }

  setSessionTitle(title: string) {
    // 通过 store 更新，响应式渲染
    // TODO: 添加标题到 store
  }

  /**
   * 初始化渲染
   */
  mount() {
    this.mounted = true;
    stdout.write(ANSI.HIDE_CURSOR);
    this.fullRender();

    // SolidJS 响应式：当 store 变化时重新渲染
    // 使用 createEffect 追踪 store
    createEffect(() => {
      // 追踪 store 的变化
      // 通过访问 store 属性建立依赖
      const _ = store.messages.length;
      const __ = Object.keys(store.parts).length;
      const ___ = store.isStreaming;
      
      // 强制重新渲染
      this.renderCount++;
      this.render();
    });
  }

  /**
   * 全屏渲染
   */
  private fullRender() {
    stdout.write(ANSI.CLEAR);

    // Header
    this.renderHeader();

    // Messages（使用 SolidJS 渲染到字符串）
    this.renderMessages();

    // Input
    this.renderInput();
  }

  /**
   * 增量渲染
   */
  private render() {
    // 调试日志：显示渲染次数
    const debugLine = `\x1b[s\x1b[1;1H[Renders: ${this.renderCount}]\x1b[u`;
    
    // 移动到消息区域下方
    const headerHeight = 3;
    const messagesHeight = this.calculateMessagesHeight();
    const inputStartLine = headerHeight + messagesHeight + 1;

    stdout.write(ANSI.GOTO(inputStartLine, 1));

    // 清除从当前位置到屏幕底部
    stdout.write("\x1b[J");

    // 渲染输入区
    this.renderInput();
  }

  private renderHeader() {
    const title = store.sessionId
      ? `Session ${store.sessionId.slice(0, 8)}`
      : "Tong Work";
    const truncatedTitle =
      title.length > this.width - 10
        ? title.slice(0, this.width - 13) + "..."
        : title;

    const padding = Math.max(0, this.width - 4 - truncatedTitle.length);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;

    let output = "";
    output +=
      color.cyan(
        border.topLeft + border.horizontal.repeat(this.width - 2) + border.topRight
      ) + "\n";
    output += color.cyan(border.vertical);
    output += " ".repeat(leftPad) + truncatedTitle + " ".repeat(rightPad);
    output += color.cyan(border.vertical) + "\n";
    output +=
      color.cyan(
        border.leftT + border.horizontal.repeat(this.width - 2) + border.rightT
      ) + "\n";

    stdout.write(output);
  }

  private renderMessages() {
    // 使用 SolidJS 渲染组件到终端
    // 这里我们手动构建输出，因为终端不支持 DOM
    let output = "";

    for (const message of store.messages) {
      const parts = store.parts[message.id] || [];
      output += this.renderMessage(message, parts);
    }

    stdout.write(output);
  }

  private renderMessage(message: any, parts: any[]): string {
    let output = "\n";

    if (message.role === "user") {
      output += this.renderUserMessage(message);
    } else if (message.role === "assistant") {
      output += this.renderAssistantParts(parts);
    } else {
      output += this.renderSystemMessage(message);
    }

    return output;
  }

  private renderUserMessage(message: any): string {
    const lines = this.wrapText(message.content, this.width - 6);
    let output = "";

    output += `  ${color.green("▌")}\n`;
    for (const line of lines) {
      output += `  ${color.green("▌")} ${line}\n`;
    }
    output += `  ${color.green("▌")}\n`;

    return output;
  }

  private renderAssistantParts(parts: any[]): string {
    let output = "";

    for (const part of parts) {
      switch (part.type) {
        case "reasoning":
          output += this.renderReasoningPart(part);
          break;
        case "text":
          output += this.renderTextPart(part);
          break;
        case "tool_call":
          output += this.renderToolCallPart(part);
          break;
        case "tool_result":
          output += this.renderToolResultPart(part);
          break;
      }
    }

    return output;
  }

  private renderReasoningPart(part: any): string {
    const text = part.content || "";
    const lines = this.wrapText(`Thinking: ${text}`, this.width - 10);
    let output = "";

    for (const line of lines) {
      output += `  ${color.gray("▌")} \x1b[3m\x1b[90m${line}\x1b[0m\n`;
    }

    return output;
  }

  private renderTextPart(part: any): string {
    const text = part.content || "";
    if (!text.trim()) return "";

    const lines = this.wrapText(text, this.width - 6);
    let output = "";

    for (const line of lines) {
      output += `     ${line}\n`;
    }

    return output;
  }

  private renderToolCallPart(part: any): string {
    const args = part.toolArgs
      ? JSON.stringify(part.toolArgs).slice(0, 50)
      : "";
    let output = `     \x1b[33m⚡ ${part.toolName}\x1b[0m`;
    if (args) output += ` \x1b[90m${args}\x1b[0m`;
    return output + "\n";
  }

  private renderToolResultPart(part: any): string {
    const success = part.success !== false;
    const icon = success ? "✓" : "✗";
    const color = success ? "\x1b[32m" : "\x1b[31m";
    const result =
      typeof part.result === "string"
        ? part.result
        : JSON.stringify(part.result).slice(0, 80);

    let output = `     ${color}${icon} ${part.toolName}\x1b[0m`;
    if (result) output += ` \x1b[90m${result}\x1b[0m`;
    return output + "\n";
  }

  private renderSystemMessage(message: any): string {
    const lines = this.wrapText(message.content, this.width - 6);
    let output = "";

    for (const line of lines) {
      output += `  \x1b[90m• ${line}\x1b[0m\n`;
    }

    return output;
  }

  private renderInput() {
    const lines = this.wrapText(this.inputBuffer, this.width - 6);
    let output = "";

    // 分隔线
    output +=
      color.cyan(
        border.leftT + border.horizontal.repeat(this.width - 2) + border.rightT
      ) + "\n";

    // 输入内容
    if (lines.length === 0) {
      output += color.cyan(border.vertical) + " " + color.gray("> _") + "\n";
    } else {
      for (const line of lines) {
        output += color.cyan(border.vertical) + " " + color.green("> ") + line;
        if (store.isStreaming) output += color.gray("█");
        output += "\n";
      }
    }

    // 底边框
    output +=
      color.cyan(
        border.bottomLeft +
          border.horizontal.repeat(this.width - 2) +
          border.bottomRight
      ) + "\n";

    // 状态栏
    const status = store.status || "Enter 发送 · Ctrl+C 退出 · Ctrl+L 清屏";
    output += color.gray(status);

    if (store.isStreaming) {
      const rightText = "Generating...";
      const padding = Math.max(0, this.width - status.length - rightText.length - 2);
      output += " ".repeat(padding) + color.gray(rightText);
    }

    output += "\n";

    stdout.write(output);
  }

  private calculateMessagesHeight(): number {
    let height = 0;

    for (const message of store.messages) {
      height += 1; // 消息间距

      if (message.role === "user") {
        const lines = this.wrapText(message.content, this.width - 6);
        height += 2 + lines.length; // 边框 + 内容
      } else if (message.role === "assistant") {
        const parts = store.parts[message.id] || [];
        for (const part of parts) {
          if (part.type === "reasoning" || part.type === "text") {
            const text = part.content || "";
            const prefix = part.type === "reasoning" ? "Thinking: " : "";
            const lines = this.wrapText(prefix + text, this.width - 6);
            height += lines.length;
          } else {
            height += 1;
          }
        }
      }
    }

    return height;
  }

  private wrapText(text: string, width: number): string[] {
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

  cleanup() {
    this.cleanupFns.forEach((fn) => fn());
    stdin.setRawMode(false);
    this.rl.close();
    stdout.write(ANSI.RESET);
    stdout.write(ANSI.SHOW_CURSOR);
    storeActions.reset();
  }
}

export function createRenderer() {
  return new SolidTUIRenderer();
}
