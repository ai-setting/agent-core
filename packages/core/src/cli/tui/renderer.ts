/**
 * @fileoverview TUI 渲染引擎 - 增量更新版本
 * 
 * 参考 OpenCode 设计，实现无闪烁的增量更新
 */

import { stdin, stdout } from "process";
import readline from "readline";
import { RESET, color, border, splitBorder, style } from "./theme";

export interface RenderOptions {
  targetFps?: number;
  exitOnCtrlC?: boolean;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  parts?: MessagePart[];
}

export interface MessagePart {
  type: "text" | "reasoning" | "tool_call" | "tool_result";
  content?: string;
  delta?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  result?: unknown;
  success?: boolean;
}

export class TUIRenderer {
  private rl: readline.Interface;
  private options: RenderOptions;
  private inputBuffer = "";
  private messages: Message[] = [];
  private onSubmit?: (text: string) => void;
  private sessionTitle = "";
  private isStreaming = false;
  private statusText = "";
  private lastContentLength = 0; // 上次渲染的内容长度
  
  // 终端尺寸
  private width = stdout.columns || 80;
  private height = stdout.rows || 24;

  constructor(options: RenderOptions = {}) {
    this.options = {
      targetFps: 30,
      exitOnCtrlC: true,
      ...options,
    };

    this.rl = readline.createInterface({
      input: stdin,
      output: stdout,
      terminal: true,
    });

    this.setupInput();
    this.setupResize();
  }

  private setupInput(): void {
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");

    stdin.on("data", (key: string) => {
      if (key === "\x03" && this.options.exitOnCtrlC) {
        this.cleanup();
        process.exit(0);
      }

      if (key === "\x0c") {
        this.fullRender();
        return;
      }

      if (key === "\r" || key === "\n") {
        if (this.inputBuffer.trim()) {
          this.onSubmit?.(this.inputBuffer);
          this.inputBuffer = "";
          this.renderInput();
        }
        return;
      }

      if (key === "\x7f") {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        this.renderInput();
        return;
      }

      if (key.charCodeAt(0) < 32) return;

      this.inputBuffer += key;
      this.renderInput();
    });
  }

  private setupResize(): void {
    process.stdout.on("resize", () => {
      this.width = stdout.columns || 80;
      this.height = stdout.rows || 24;
      this.fullRender();
    });
  }

  setOnSubmit(callback: (text: string) => void): void {
    this.onSubmit = callback;
  }

  setSessionTitle(title: string): void {
    this.sessionTitle = title;
    this.fullRender();
  }

  setStreaming(isStreaming: boolean): void {
    this.isStreaming = isStreaming;
    this.renderStatus();
  }

  setStatus(status: string): void {
    this.statusText = status;
    this.renderStatus();
  }

  addMessage(message: Message): void {
    this.messages.push(message);
    this.renderNewMessage(message);
  }

  appendToLastMessage(content: string): void {
    if (this.messages.length === 0) return;
    const lastMsg = this.messages[this.messages.length - 1];
    lastMsg.content += content;
    this.updateLastMessage();
  }

  updateLastMessageParts(parts: MessagePart[]): void {
    if (this.messages.length === 0) return;
    const lastMsg = this.messages[this.messages.length - 1];
    lastMsg.parts = parts;
    this.updateLastMessage();
  }

  // 增量更新最后一条消息
  private updateLastMessage(): void {
    if (this.messages.length === 0) return;
    
    const msg = this.messages[this.messages.length - 1];
    const content = this.renderMessageContent(msg);
    
    // 移动到消息位置并重新渲染
    const lines = content.split("\n");
    
    // 移动到倒数第二行（状态栏上方）
    stdout.write(`\x1b[${this.height - 2};1H`);
    
    // 清除从当前位置到屏幕底部的内容
    stdout.write("\x1b[J");
    
    // 重新渲染输入区和状态栏
    stdout.write(this.renderInputArea());
    
    // 移动光标到输入位置
    const inputLines = this.inputBuffer.split("\n").length;
    const cursorLine = this.height - 2 - inputLines;
    stdout.write(`\x1b[${cursorLine};4H`);
  }

  // 渲染新消息（追加到末尾）
  private renderNewMessage(msg: Message): void {
    const content = this.renderMessageContent(msg);
    
    // 移动到倒数第二行
    stdout.write(`\x1b[${this.height - 2};1H`);
    
    // 清除输入区和状态栏
    stdout.write("\x1b[J");
    
    // 渲染消息
    stdout.write(content);
    
    // 渲染输入区和状态栏
    stdout.write(this.renderInputArea());
  }

  // 渲染单条消息的内容（不移动到特定位置）
  private renderMessageContent(msg: Message): string {
    let output = "\n";
    
    if (msg.role === "user") {
      output += this.renderUserMessage(msg);
    } else if (msg.role === "assistant") {
      output += this.renderAssistantMessage(msg);
    } else {
      output += this.renderSystemMessage(msg);
    }
    
    return output;
  }

  private renderUserMessage(msg: Message): string {
    let output = "";
    const lines = this.wrapText(msg.content, this.width - 6);
    
    output += "  " + color.green(splitBorder.vertical) + "\n";
    for (const line of lines) {
      output += "  " + color.green(splitBorder.vertical) + " " + line + "\n";
    }
    output += "  " + color.green(splitBorder.vertical) + "\n";
    
    return output;
  }

  private renderAssistantMessage(msg: Message): string {
    let output = "";
    
    if (msg.parts && msg.parts.length > 0) {
      for (const part of msg.parts) {
        switch (part.type) {
          case "reasoning":
            output += this.renderReasoning(part);
            break;
          case "text":
            output += this.renderTextPart(part);
            break;
          case "tool_call":
            output += this.renderToolCall(part);
            break;
          case "tool_result":
            output += this.renderToolResult(part);
            break;
        }
      }
    } else {
      const lines = this.wrapText(msg.content, this.width - 6);
      for (const line of lines) {
        output += "     " + line + "\n";
      }
    }
    
    return output;
  }

  private renderReasoning(part: MessagePart): string {
    let output = "";
    const text = part.content || "";
    const lines = this.wrapText(text, this.width - 10);
    
    if (lines.length === 0) return output;
    
    output += "  " + color.gray(splitBorder.vertical) + " " + style.italic(color.gray("Thinking: " + lines[0])) + "\n";
    
    for (let i = 1; i < lines.length; i++) {
      output += "  " + color.gray(splitBorder.vertical) + " " + style.italic(color.gray(lines[i])) + "\n";
    }
    
    return output;
  }

  private renderTextPart(part: MessagePart): string {
    let output = "";
    const text = part.content || "";
    
    if (!text.trim()) return output;
    
    const lines = this.wrapText(text, this.width - 6);
    for (const line of lines) {
      output += "     " + line + "\n";
    }
    
    return output;
  }

  private renderToolCall(part: MessagePart): string {
    let output = "";
    const toolName = part.toolName || "tool";
    const args = part.toolArgs ? JSON.stringify(part.toolArgs).slice(0, 50) : "";
    
    output += "     " + color.yellow("⚡ " + toolName);
    if (args) output += " " + color.gray(args);
    output += "\n";
    
    return output;
  }

  private renderToolResult(part: MessagePart): string {
    let output = "";
    const toolName = part.toolName || "tool";
    const success = part.success !== false;
    const icon = success ? "✓" : "✗";
    const iconColor = success ? color.green : color.red;
    
    let resultStr = "";
    if (part.result !== undefined) {
      resultStr = typeof part.result === "string" 
        ? part.result 
        : JSON.stringify(part.result);
      resultStr = resultStr.slice(0, 80);
    }
    
    output += "     " + iconColor(icon + " " + toolName);
    if (resultStr) output += " " + color.gray(resultStr);
    output += "\n";
    
    return output;
  }

  private renderSystemMessage(msg: Message): string {
    let output = "";
    const lines = this.wrapText(msg.content, this.width - 6);
    for (const line of lines) {
      output += "  " + color.gray("• " + line) + "\n";
    }
    return output;
  }

  // 渲染输入区域和状态栏
  private renderInputArea(): string {
    let output = "";
    
    // 分隔线
    output += color.cyan(border.leftT + border.horizontal.repeat(this.width - 2) + border.rightT) + "\n";
    
    // 输入内容
    const inputLines = this.wrapText(this.inputBuffer, this.width - 6);
    if (inputLines.length === 0) {
      output += color.cyan(border.vertical) + " " + color.gray("> _") + "\n";
    } else {
      for (const line of inputLines) {
        output += color.cyan(border.vertical) + " " + color.green("> ") + line;
        if (this.isStreaming) output += color.gray("█");
        output += "\n";
      }
    }
    
    // 底边框
    output += color.cyan(border.bottomLeft + border.horizontal.repeat(this.width - 2) + border.bottomRight) + "\n";
    
    // 状态栏
    output += this.getStatusLine();
    
    return output;
  }

  private getStatusLine(): string {
    let output = color.gray(this.statusText || "Enter 发送 · Ctrl+C 退出 · Ctrl+L 清屏");
    
    if (this.isStreaming) {
      const rightText = "Generating...";
      const padding = Math.max(0, this.width - output.length - rightText.length - 2);
      output += " ".repeat(padding) + color.gray(rightText);
    }
    
    return output + "\n";
  }

  // 渲染输入区（用于输入时更新）
  private renderInput(): void {
    // 保存光标位置
    stdout.write("\x1b[s");
    
    // 移动到状态栏上方
    const inputLines = Math.max(1, this.inputBuffer.split("\n").length);
    const startLine = this.height - 1 - inputLines;
    stdout.write(`\x1b[${startLine};1H`);
    
    // 清除输入区和状态栏
    for (let i = 0; i < inputLines + 2; i++) {
      stdout.write("\x1b[K\n");
    }
    
    // 移动回原位
    stdout.write(`\x1b[${startLine};1H`);
    
    // 重新渲染
    stdout.write(this.renderInputArea());
    
    // 恢复光标位置
    stdout.write("\x1b[u");
  }

  // 渲染状态栏
  private renderStatus(): void {
    // 移动到最后一行
    stdout.write(`\x1b[${this.height};1H`);
    stdout.write("\x1b[K");
    stdout.write(this.getStatusLine());
  }

  // 全屏渲染（初始化或清屏时使用）
  fullRender(): void {
    stdout.write("\x1b[2J\x1b[H");
    
    // Header
    stdout.write(this.renderHeader());
    
    // 所有消息
    for (const msg of this.messages) {
      stdout.write(this.renderMessageContent(msg));
    }
    
    // 输入区
    stdout.write(this.renderInputArea());
  }

  private renderHeader(): string {
    const title = this.sessionTitle || "Tong Work";
    const truncatedTitle = title.length > this.width - 10 
      ? title.slice(0, this.width - 13) + "..." 
      : title;
    
    let output = "";
    output += color.cyan(border.topLeft + border.horizontal.repeat(this.width - 2) + border.topRight) + "\n";
    
    const titlePadding = Math.max(0, this.width - 4 - truncatedTitle.length);
    const leftPad = Math.floor(titlePadding / 2);
    const rightPad = titlePadding - leftPad;
    
    output += color.cyan(border.vertical);
    output += " ".repeat(leftPad) + style.bold(truncatedTitle) + " ".repeat(rightPad);
    output += color.cyan(border.vertical) + "\n";
    output += color.cyan(border.leftT + border.horizontal.repeat(this.width - 2) + border.rightT) + "\n";
    
    return output;
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

  cleanup(): void {
    stdin.setRawMode(false);
    this.rl.close();
    stdout.write(RESET);
    stdout.write("\x1b[?25h");
  }
}

export function createRenderer(options: RenderOptions = {}): TUIRenderer {
  return new TUIRenderer(options);
}
