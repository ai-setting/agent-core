/**
 * @fileoverview TUI Renderer - with custom reactive store
 */

import { stdin, stdout } from "process";
import readline from "readline";
import { store, createEffect } from "./store";
import type { Message, MessagePart } from "./types";

const ANSI = {
  CLEAR: "\x1b[2J\x1b[H",
  RESET: "\x1b[0m",
  HIDE_CURSOR: "\x1b[?25l",
  SHOW_CURSOR: "\x1b[?25h",
};

const color = {
  cyan: (text: string) => `\x1b[36m${text}\x1b[0m`,
  green: (text: string) => `\x1b[32m${text}\x1b[0m`,
  gray: (text: string) => `\x1b[90m${text}\x1b[0m`,
  yellow: (text: string) => `\x1b[33m${text}\x1b[0m`,
  red: (text: string) => `\x1b[31m${text}\x1b[0m`,
};

const border = {
  topLeft: "┌", topRight: "┐", bottomLeft: "└", bottomRight: "┘",
  horizontal: "─", vertical: "│", leftT: "├", rightT: "┤", split: "▌",
};

export class TUIRenderer {
  private rl: readline.Interface;
  private width = stdout.columns || 80;
  private height = stdout.rows || 24;
  private inputBuffer = "";
  private onSubmit?: (text: string) => void;
  private renderCount = 0;
  private isMounted = false;

  constructor() {
    this.rl = readline.createInterface({
      input: stdin,
      output: stdout,
      terminal: true,
    });
    this.setupInput();
  }

  private setupInput() {
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");

    stdin.on("data", (key: string) => {
      if (key === "\x03") {
        this.cleanup();
        process.exit(0);
      }
      if (key === "\x0c") {
        this.render();
        return;
      }
      if (key === "\r" || key === "\n") {
        if (this.inputBuffer.trim()) {
          this.onSubmit?.(this.inputBuffer);
          this.inputBuffer = "";
        }
        return;
      }
      if (key === "\x7f") {
        this.inputBuffer = this.inputBuffer.slice(0, -1);
        return;
      }
      if (key.charCodeAt(0) < 32) return;
      this.inputBuffer += key;
    });
  }

  setOnSubmit(callback: (text: string) => void) {
    this.onSubmit = callback;
  }

  mount() {
    this.isMounted = true;
    stdout.write(ANSI.HIDE_CURSOR);
    
    // Subscribe to store changes
    createEffect(() => {
      // Access all reactive data
      const _messages = store.messages;
      const _parts = store.parts;
      const _streaming = store.isStreaming;
      
      this.renderCount++;
      this.render();
    });
  }

  private render() {
    if (!this.isMounted) return;

    let output = "";
    
    // Header
    output += this.buildHeader();
    
    // Messages
    for (const message of store.messages) {
      const parts = store.parts[message.id] || [];
      output += this.buildMessage(message, parts);
    }
    
    // Input
    output += this.buildInput();
    
    // Debug
    const partsCount = Object.values(store.parts).reduce((acc, p) => acc + (p?.length || 0), 0);
    output += color.gray(`[Msg:${store.messages.length} Parts:${partsCount} Renders:${this.renderCount}]`) + "\n";
    
    // Clear and render
    stdout.write(ANSI.CLEAR);
    stdout.write(output);
  }

  private buildHeader(): string {
    const title = store.sessionId ? `Session ${store.sessionId.slice(0, 8)}` : "Tong Work";
    const truncated = title.length > this.width - 10 ? title.slice(0, this.width - 13) + "..." : title;
    const pad = Math.max(0, this.width - 4 - truncated.length);
    const leftPad = Math.floor(pad / 2);
    const rightPad = pad - leftPad;
    
    let out = "";
    out += color.cyan(border.topLeft + border.horizontal.repeat(this.width - 2) + border.topRight) + "\n";
    out += color.cyan(border.vertical) + " ".repeat(leftPad) + truncated + " ".repeat(rightPad) + color.cyan(border.vertical) + "\n";
    out += color.cyan(border.leftT + border.horizontal.repeat(this.width - 2) + border.rightT) + "\n";
    return out;
  }

  private buildMessage(message: Message, parts: MessagePart[]): string {
    let out = "\n";
    
    if (message.role === "user") {
      const lines = this.wrapText(message.content, this.width - 6);
      out += `  ${color.green(border.split)}\n`;
      for (const line of lines) {
        out += `  ${color.green(border.split)} ${line}\n`;
      }
      out += `  ${color.green(border.split)}\n`;
    } else if (message.role === "assistant") {
      for (const part of parts) {
        out += this.buildPart(part);
      }
    } else {
      const lines = this.wrapText(message.content, this.width - 6);
      for (const line of lines) {
        out += `  ${color.gray("• " + line)}\n`;
      }
    }
    
    return out;
  }

  private buildPart(part: MessagePart): string {
    let out = "";
    
    switch (part.type) {
      case "reasoning": {
        const text = part.content || "";
        if (text) {
          const lines = this.wrapText(`Thinking: ${text}`, this.width - 10);
          for (const line of lines) {
            out += `  ${color.gray(border.split)} \x1b[3m\x1b[90m${line}\x1b[0m\n`;
          }
        }
        break;
      }
      case "text": {
        const text = part.content || "";
        if (text) {
          const lines = this.wrapText(text, this.width - 6);
          for (const line of lines) {
            out += `     ${line}\n`;
          }
        }
        break;
      }
      case "tool_call": {
        const args = part.toolArgs ? JSON.stringify(part.toolArgs).slice(0, 50) : "";
        out += `     ${color.yellow(`⚡ ${part.toolName}`)}`;
        if (args) out += ` ${color.gray(args)}`;
        out += "\n";
        break;
      }
      case "tool_result": {
        const success = part.success !== false;
        const icon = success ? "✓" : "✗";
        const iconColor = success ? color.green : color.red;
        const result = typeof part.result === "string" ? part.result : JSON.stringify(part.result).slice(0, 80);
        out += `     ${iconColor(icon + " " + part.toolName)}`;
        if (result) out += ` ${color.gray(result)}`;
        out += "\n";
        break;
      }
    }
    
    return out;
  }

  private buildInput(): string {
    const lines = this.wrapText(this.inputBuffer, this.width - 6);
    let out = "";
    
    out += color.cyan(border.leftT + border.horizontal.repeat(this.width - 2) + border.rightT) + "\n";
    
    if (lines.length === 0) {
      out += color.cyan(border.vertical) + " " + color.gray("> _") + "\n";
    } else {
      for (const line of lines) {
        out += color.cyan(border.vertical) + " " + color.green("> ") + line;
        if (store.isStreaming) out += color.gray("█");
        out += "\n";
      }
    }
    
    out += color.cyan(border.bottomLeft + border.horizontal.repeat(this.width - 2) + border.bottomRight) + "\n";
    
    const status = store.status || "Enter 发送 · Ctrl+C 退出 · Ctrl+L 清屏";
    out += color.gray(status);
    if (store.isStreaming) {
      const rightText = "Generating...";
      const padding = Math.max(0, this.width - status.length - rightText.length - 2);
      out += " ".repeat(padding) + color.gray(rightText);
    }
    out += "\n";
    
    return out;
  }

  private wrapText(text: string, width: number): string[] {
    const lines: string[] = [];
    for (const para of text.split("\n")) {
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
    this.isMounted = false;
    stdin.setRawMode(false);
    this.rl.close();
    stdout.write(ANSI.RESET + ANSI.SHOW_CURSOR);
  }
}

export function createRenderer() {
  return new TUIRenderer();
}
