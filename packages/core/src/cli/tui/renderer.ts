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
  
  // 跟踪每个 part 的已渲染长度，实现真正的增量更新
  private renderedParts: Map<string, number> = new Map();
  private lastMessageY = 0; // 最后一条消息的起始行号
  
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
    // 清理旧消息的渲染状态
    if (message.role === "assistant") {
      // 只清理当前消息的渲染状态（新消息）
      for (const key of this.renderedParts.keys()) {
        if (key.startsWith(message.id)) {
          this.renderedParts.delete(key);
        }
      }
    }
    this.messages.push(message);
    this.renderNewMessage(message);
  }

  appendToLastMessage(content: string): void {
    if (this.messages.length === 0) return;
    const lastMsg = this.messages[this.messages.length - 1];
    lastMsg.content += content;
    // 简单追加，不重渲染
  }

  updateLastMessageParts(parts: MessagePart[]): void {
    if (this.messages.length === 0) return;
    const lastMsg = this.messages[this.messages.length - 1];
    const oldParts = lastMsg.parts || [];
    lastMsg.parts = parts;
    
    // 计算输入区高度
    const inputLines = Math.max(1, this.wrapText(this.inputBuffer, this.width - 6).length);
    const inputAreaHeight = inputLines + 3;
    
    // 移动到输入区上方
    const clearStartLine = this.height - inputAreaHeight;
    stdout.write(`\x1b[${clearStartLine};1H`);
    
    // 清除输入区和状态栏
    for (let i = 0; i < inputAreaHeight; i++) {
      stdout.write("\x1b[K\n");
    }
    
    // 移动回原位
    stdout.write(`\x1b[${clearStartLine};1H`);
    
    // 只渲染新增或变化的内容
    let output = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const oldPart = oldParts[i];
      const partId = `${lastMsg.id}-${i}`;
      const renderedLen = this.renderedParts.get(partId) || 0;
      
      if (part.type === "reasoning" || part.type === "text") {
        const content = part.content || "";
        const isReasoning = part.type === "reasoning";
        const prefix = isReasoning ? "Thinking: " : "";
        const indent = isReasoning ? "  " : "     ";
        const width = isReasoning ? this.width - 10 : this.width - 6;
        
        // 如果内容有更新
        if (content.length > renderedLen) {
          const fullText = prefix + content;
          const lines = this.wrapText(fullText, width);
          const oldLines = renderedLen > 0 ? this.wrapText(prefix + content.slice(0, renderedLen), width) : [];
          
          // 只渲染新增的行
          for (let j = oldLines.length; j < lines.length; j++) {
            if (isReasoning) {
              output += "  " + color.gray(splitBorder.vertical) + " " + style.italic(color.gray(lines[j])) + "\n";
            } else {
              output += "     " + lines[j] + "\n";
            }
          }
          
          // 如果最后一行有更新（未完整换行的情况），需要重新渲染最后一行
          if (oldLines.length > 0 && lines.length === oldLines.length) {
            const lastOldLine = oldLines[oldLines.length - 1];
            const lastNewLine = lines[lines.length - 1];
            if (lastNewLine.length > lastOldLine.length) {
              // 回到上一行重新渲染
              output += "\x1b[1A\x1b[K"; // 上移一行并清除
              if (isReasoning) {
                output += "  " + color.gray(splitBorder.vertical) + " " + style.italic(color.gray(lastNewLine)) + "\n";
              } else {
                output += "     " + lastNewLine + "\n";
              }
            }
          }
          
          this.renderedParts.set(partId, content.length);
        }
      } else if (part.type === "tool_call") {
        // 工具调用只渲染一次
        if (!this.renderedParts.has(partId)) {
          output += this.renderToolCall(part);
          this.renderedParts.set(partId, 1);
        }
      } else if (part.type === "tool_result") {
        // 工具结果只渲染一次
        if (!this.renderedParts.has(partId)) {
          output += this.renderToolResult(part);
          this.renderedParts.set(partId, 1);
        }
      }
    }
    
    stdout.write(output);
    
    // 渲染输入区和状态栏
    stdout.write(this.renderInputArea());
    
    // 移动光标到输入位置
    const cursorLine = this.height - 1;
    stdout.write(`\x1b[${cursorLine};4H`);
  }

  // 渲染新消息（追加到末尾）
  private renderNewMessage(msg: Message): void {
    // 获取当前输入区的行数
    const inputLines = Math.max(1, this.wrapText(this.inputBuffer, this.width - 6).length);
    const inputAreaHeight = inputLines + 3; // 输入内容 + 边框(2) + 状态栏(1)
    
    // 移动到输入区上方开始清除
    const clearStartLine = this.height - inputAreaHeight;
    stdout.write(`\x1b[${clearStartLine};1H`);
    
    // 清除输入区和状态栏
    for (let i = 0; i < inputAreaHeight; i++) {
      stdout.write("\x1b[K\n");
    }
    
    // 移动回原位
    stdout.write(`\x1b[${clearStartLine};1H`);
    
    // 渲染消息
    const content = this.renderMessageContent(msg);
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
    // 获取输入区高度
    const inputLines = Math.max(1, this.wrapText(this.inputBuffer, this.width - 6).length);
    const inputAreaHeight = inputLines + 3; // 输入内容 + 边框(2) + 状态栏(1)
    
    // 移动到输入区开始位置
    const startLine = this.height - inputAreaHeight + 1;
    stdout.write(`\x1b[${startLine};1H`);
    
    // 清除输入区和状态栏
    for (let i = 0; i < inputAreaHeight; i++) {
      stdout.write("\x1b[K\n");
    }
    
    // 移动回原位
    stdout.write(`\x1b[${startLine};1H`);
    
    // 重新渲染输入区
    stdout.write(this.renderInputArea());
    
    // 移动光标到输入位置（最后一行输入框内）
    const cursorLine = this.height - 1;
    const cursorCol = 4 + (this.inputBuffer.length % (this.width - 6));
    stdout.write(`\x1b[${cursorLine};${cursorCol}H`);
  }

  // 渲染状态栏
  private renderStatus(): void {
    // 移动到最后一行
    stdout.write(`\x1b[${this.height};1H`);
    stdout.write("\x1b[2K"); // 清除整行
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
