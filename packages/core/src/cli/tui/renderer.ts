/**
 * @fileoverview TUI 渲染引擎
 * 
 * 参考 OpenCode 设计，实现现代化的终端 UI
 */

import { stdin, stdout } from "process";
import readline from "readline";
import { defaultTheme, RESET, style, color, border, splitBorder } from "./theme";

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
  private renderTimer: Timer | null = null;
  private lastRender = 0;
  private scrollOffset = 0;
  private sessionTitle = "";
  private isStreaming = false;
  private statusText = "";
  
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
      // Ctrl+C
      if (key === "\x03" && this.options.exitOnCtrlC) {
        this.cleanup();
        process.exit(0);
      }

      // Ctrl+L - 清屏
      if (key === "\x0c") {
        this.scrollOffset = 0;
        this.render();
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
      if (key.charCodeAt(0) < 32) {
        return;
      }

      // 普通字符
      this.inputBuffer += key;
      this.render();
    });
  }

  private setupResize(): void {
    process.stdout.on("resize", () => {
      this.width = stdout.columns || 80;
      this.height = stdout.rows || 24;
      this.render();
    });
  }

  setOnSubmit(callback: (text: string) => void): void {
    this.onSubmit = callback;
  }

  setSessionTitle(title: string): void {
    this.sessionTitle = title;
    this.scheduleRender();
  }

  setStreaming(isStreaming: boolean): void {
    this.isStreaming = isStreaming;
    this.statusText = isStreaming ? "Generating..." : "";
    this.scheduleRender();
  }

  setStatus(status: string): void {
    this.statusText = status;
    this.scheduleRender();
  }

  addMessage(message: Message): void {
    this.messages.push(message);
    this.scrollToBottom();
    this.scheduleRender();
  }

  appendToLastMessage(content: string): void {
    if (this.messages.length === 0) return;
    
    const lastMsg = this.messages[this.messages.length - 1];
    lastMsg.content += content;
    this.scheduleRender();
  }

  updateLastMessageParts(parts: MessagePart[]): void {
    if (this.messages.length === 0) return;
    
    const lastMsg = this.messages[this.messages.length - 1];
    lastMsg.parts = parts;
    this.scheduleRender();
  }

  scrollToBottom(): void {
    const contentHeight = this.calculateContentHeight();
    const visibleHeight = this.height - 6; // 减去 header, input, status
    this.scrollOffset = Math.max(0, contentHeight - visibleHeight);
  }

  scrollBy(delta: number): void {
    const contentHeight = this.calculateContentHeight();
    const visibleHeight = this.height - 6;
    const maxOffset = Math.max(0, contentHeight - visibleHeight);
    
    this.scrollOffset = Math.max(0, Math.min(maxOffset, this.scrollOffset + delta));
    this.render();
  }

  private calculateContentHeight(): number {
    let height = 0;
    for (const msg of this.messages) {
      height += this.calculateMessageHeight(msg);
    }
    return height;
  }

  private calculateMessageHeight(msg: Message): number {
    const contentWidth = this.width - 6; // 减去边框和padding
    let height = 0;
    
    if (msg.role === "user") {
      // 用户消息：上下边框 + 内容行
      const lines = this.wrapText(msg.content, contentWidth);
      height = 2 + lines.length; // 2 for borders
    } else if (msg.role === "assistant" && msg.parts && msg.parts.length > 0) {
      // AI 消息：基于 parts 计算
      for (const part of msg.parts) {
        switch (part.type) {
          case "reasoning": {
            const text = part.content || "";
            const lines = this.wrapText(text, contentWidth - 4);
            height += lines.length;
            break;
          }
          case "text": {
            const text = part.content || "";
            const lines = this.wrapText(text, contentWidth);
            height += lines.length;
            break;
          }
          case "tool_call":
          case "tool_result":
            height += 1;
            break;
        }
      }
    } else {
      // 纯文本或系统消息
      const lines = this.wrapText(msg.content, contentWidth);
      height = lines.length;
    }
    
    return height;
  }

  private scheduleRender(): void {
    if (this.renderTimer) return;

    const elapsed = Date.now() - this.lastRender;
    
    // 限制渲染频率，最多每 100ms 渲染一次
    const minRenderInterval = 100;
    
    if (elapsed < minRenderInterval) {
      this.renderTimer = setTimeout(() => {
        this.renderTimer = null;
        this.render();
      }, minRenderInterval - elapsed);
      return;
    }

    this.render();
  }

  render(): void {
    this.lastRender = Date.now();
    
    // 清屏
    stdout.write("\x1b[2J\x1b[H");

    let output = "";
    
    // Header
    output += this.renderHeader();
    
    // 消息区域
    output += this.renderMessages();
    
    // 输入区域
    output += this.renderInput();
    
    // 状态栏
    output += this.renderStatus();

    stdout.write(output);
  }

  private renderHeader(): string {
    const title = this.sessionTitle || "Tong Work";
    const truncatedTitle = title.length > this.width - 10 
      ? title.slice(0, this.width - 13) + "..." 
      : title;
    
    let output = "";
    
    // 顶部边框
    output += color.cyan(border.topLeft + border.horizontal.repeat(this.width - 2) + border.topRight);
    output += "\n";
    
    // 标题行
    const titlePadding = Math.max(0, this.width - 4 - truncatedTitle.length);
    const leftPad = Math.floor(titlePadding / 2);
    const rightPad = titlePadding - leftPad;
    
    output += color.cyan(border.vertical);
    output += " ".repeat(leftPad);
    output += style.bold(truncatedTitle);
    output += " ".repeat(rightPad);
    output += color.cyan(border.vertical);
    output += "\n";
    
    // 分隔线
    output += color.cyan(border.leftT + border.horizontal.repeat(this.width - 2) + border.rightT);
    output += "\n";
    
    return output;
  }

  private renderMessages(): string {
    const visibleHeight = this.height - 8; // 减去 header(3) + input(3) + status(2)
    const contentWidth = this.width - 6;
    
    let output = "";
    let currentHeight = 0;
    
    // 收集要显示的消息
    const visibleMessages: { msg: Message; startLine: number }[] = [];
    let lineCount = 0;
    
    for (const msg of this.messages) {
      const msgHeight = this.calculateMessageHeight(msg);
      if (lineCount + msgHeight > this.scrollOffset) {
        visibleMessages.push({ msg, startLine: lineCount - this.scrollOffset });
      }
      lineCount += msgHeight;
      if (lineCount - this.scrollOffset > visibleHeight) break;
    }
    
    // 渲染消息
    for (const { msg } of visibleMessages) {
      output += this.renderMessage(msg, contentWidth);
      currentHeight += this.calculateMessageHeight(msg);
      if (currentHeight > visibleHeight) break;
    }
    
    // 填充剩余空间
    const remainingLines = Math.max(0, visibleHeight - currentHeight);
    output += "\n".repeat(remainingLines);
    
    return output;
  }

  private renderMessage(msg: Message, contentWidth: number): string {
    let output = "";
    
    if (msg.role === "user") {
      // 用户消息 - 左侧边框（OpenCode 风格）
      output += this.renderUserMessage(msg, contentWidth);
    } else if (msg.role === "assistant") {
      // AI 消息
      output += this.renderAssistantMessage(msg, contentWidth);
    } else {
      // 系统消息
      output += this.renderSystemMessage(msg, contentWidth);
    }
    
    return output;
  }

  private renderUserMessage(msg: Message, contentWidth: number): string {
    let output = "";
    const lines = this.wrapText(msg.content, contentWidth);
    
    // 上边框
    output += "  " + color.green(splitBorder.vertical) + "\n";
    
    // 内容
    for (const line of lines) {
      output += "  " + color.green(splitBorder.vertical) + " " + line + "\n";
    }
    
    // 下边框
    output += "  " + color.green(splitBorder.vertical) + "\n";
    
    return output;
  }

  private renderAssistantMessage(msg: Message, contentWidth: number): string {
    let output = "";
    
    if (msg.parts && msg.parts.length > 0) {
      // 有结构化 parts，按 part 渲染
      for (const part of msg.parts) {
        switch (part.type) {
          case "reasoning":
            output += this.renderReasoning(part, contentWidth);
            break;
          case "text":
            output += this.renderTextPart(part, contentWidth);
            break;
          case "tool_call":
            output += this.renderToolCall(part, contentWidth);
            break;
          case "tool_result":
            output += this.renderToolResult(part, contentWidth);
            break;
        }
      }
    } else {
      // 纯文本内容
      const lines = this.wrapText(msg.content, contentWidth);
      for (const line of lines) {
        output += "     " + line + "\n";
      }
    }
    
    return output;
  }

  private renderReasoning(part: MessagePart, contentWidth: number): string {
    let output = "";
    const text = part.content || "";
    const lines = this.wrapText(text, contentWidth - 4);
    
    // Thinking: 标签
    output += "  " + color.gray(splitBorder.vertical) + " " + style.italic(color.gray("Thinking: "));
    
    // 第一行直接跟在标签后
    if (lines.length > 0) {
      output += style.italic(color.gray(lines[0])) + "\n";
    }
    
    // 剩余行
    for (let i = 1; i < lines.length; i++) {
      output += "  " + color.gray(splitBorder.vertical) + " " + style.italic(color.gray(lines[i])) + "\n";
    }
    
    return output;
  }

  private renderTextPart(part: MessagePart, contentWidth: number): string {
    let output = "";
    // 使用 content 渲染完整内容，而不是 delta
    const text = part.content || "";
    
    if (!text.trim()) return output;
    
    const lines = this.wrapText(text, contentWidth);
    for (const line of lines) {
      output += "     " + line + "\n";
    }
    
    return output;
  }

  private renderToolCall(part: MessagePart, contentWidth: number): string {
    let output = "";
    const toolName = part.toolName || "tool";
    const args = part.toolArgs ? JSON.stringify(part.toolArgs).slice(0, 50) : "";
    
    output += "     " + color.yellow("⚡ " + toolName);
    if (args) {
      output += " " + color.gray(args);
    }
    output += "\n";
    
    return output;
  }

  private renderToolResult(part: MessagePart, contentWidth: number): string {
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
    if (resultStr) {
      output += " " + color.gray(resultStr);
    }
    output += "\n";
    
    return output;
  }

  private renderSystemMessage(msg: Message, contentWidth: number): string {
    let output = "";
    const lines = this.wrapText(msg.content, contentWidth);
    
    for (const line of lines) {
      output += "  " + color.gray("• " + line) + "\n";
    }
    
    return output;
  }

  private renderInput(): string {
    let output = "";
    
    // 分隔线
    output += color.cyan(border.leftT + border.horizontal.repeat(this.width - 2) + border.rightT);
    output += "\n";
    
    // 输入提示符
    const inputLines = this.wrapText(this.inputBuffer, this.width - 6);
    
    if (inputLines.length === 0) {
      output += color.cyan(border.vertical) + " " + color.gray("> _") + "\n";
    } else {
      for (let i = 0; i < inputLines.length; i++) {
        output += color.cyan(border.vertical) + " " + color.green("> ");
        output += inputLines[i];
        if (i === inputLines.length - 1 && this.isStreaming) {
          output += color.gray("█");
        }
        output += "\n";
      }
    }
    
    // 底边框
    output += color.cyan(border.bottomLeft + border.horizontal.repeat(this.width - 2) + border.bottomRight);
    output += "\n";
    
    return output;
  }

  private renderStatus(): string {
    let output = "";
    
    if (this.statusText) {
      output += color.gray(this.statusText);
    } else {
      output += color.gray("Enter 发送 · Ctrl+C 退出 · Ctrl+L 清屏");
    }
    
    // 右对齐模型信息（如果有）
    const rightText = this.isStreaming ? "Generating..." : "";
    if (rightText) {
      const leftWidth = output.length;
      const padding = Math.max(0, this.width - leftWidth - rightText.length - 2);
      output += " ".repeat(padding) + color.gray(rightText);
    }
    
    output += "\n";
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
        if (remaining) {
          lines.push(remaining);
        }
      }
    }
    
    return lines;
  }

  cleanup(): void {
    stdin.setRawMode(false);
    this.rl.close();
    stdout.write(RESET);
    stdout.write("\x1b[?25h"); // 显示光标
  }
}

/**
 * 创建 TUI 渲染器
 */
export function createRenderer(options: RenderOptions = {}): TUIRenderer {
  return new TUIRenderer(options);
}
