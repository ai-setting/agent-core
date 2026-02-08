/**
 * @fileoverview 基础 TUI 渲染层
 * 
 * 简化的终端 UI 渲染实现，使用 ANSI 转义码
 * 参考 OpenTUI API 设计，便于后续迁移
 */

import { stdin, stdout } from "process";
import readline from "readline";

export interface RenderOptions {
  targetFps?: number;
  exitOnCtrlC?: boolean;
}

export interface BoxProps {
  children?: (string | Box)[];
  flexDirection?: "row" | "column";
  flexGrow?: number;
  flexShrink?: number;
  padding?: number | [number, number] | [number, number, number, number];
  margin?: number | [number, number] | [number, number, number, number];
  border?: ["top"] | ["bottom"] | ["left"] | ["right"] | true;
  borderColor?: string;
  gap?: number;
  height?: number | "100%";
  width?: number | "100%";
  backgroundColor?: string;
}

export class Box {
  props: BoxProps;
  children: (string | Box)[] = [];

  constructor(props: BoxProps = {}) {
    this.props = props;
    this.children = props.children || [];
  }

  appendChild(child: string | Box): void {
    this.children.push(child);
  }

  render(): string {
    const lines: string[] = [];
    const padding = this.normalizePadding(this.props.padding);
    
    // 添加顶部边框
    const border = this.props.border;
    if (border === true || 
        (Array.isArray(border) && border.includes("top" as never))) {
      lines.push(this.renderBorderLine("top"));
    }

    // 添加上内边距
    for (let i = 0; i < padding[0]; i++) {
      lines.push(" ");
    }

    // 渲染子元素
    for (const child of this.children) {
      if (typeof child === "string") {
        const childLines = child.split("\n");
        for (const line of childLines) {
          lines.push(" ".repeat(padding[3]) + line + " ".repeat(padding[1]));
        }
      } else {
        const childContent = child.render();
        const childLines = childContent.split("\n");
        for (const line of childLines) {
          lines.push(" ".repeat(padding[3]) + line + " ".repeat(padding[1]));
        }
      }
    }

    // 添加下内边距
    for (let i = 0; i < padding[2]; i++) {
      lines.push(" ");
    }

    // 添加底部边框
    if (border === true || 
        (Array.isArray(border) && border.includes("bottom" as never))) {
      lines.push(this.renderBorderLine("bottom"));
    }

    return lines.join("\n");
  }

  private normalizePadding(padding?: BoxProps["padding"]): [number, number, number, number] {
    if (!padding) return [0, 0, 0, 0];
    if (typeof padding === "number") return [padding, padding, padding, padding];
    if (padding.length === 2) return [padding[0], padding[1], padding[0], padding[1]];
    return padding as [number, number, number, number];
  }

  private renderBorderLine(_position: string): string {
    const width = stdout.columns || 80;
    const char = "─";
    const color = this.props.borderColor || "gray";
    return this.colorize(char.repeat(width - 1), color);
  }

  private colorize(text: string, color?: string): string {
    const colors: Record<string, string> = {
      black: "\x1b[30m",
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      blue: "\x1b[34m",
      magenta: "\x1b[35m",
      cyan: "\x1b[36m",
      white: "\x1b[37m",
      gray: "\x1b[90m",
    };
    const reset = "\x1b[0m";
    
    if (!color || !colors[color]) return text;
    return `${colors[color]}${text}${reset}`;
  }
}

export interface TextProps {
  children?: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
}

export class Text {
  props: TextProps;

  constructor(props: TextProps = {}) {
    this.props = props;
  }

  render(): string {
    let text = this.props.children || "";
    
    if (this.props.bold) {
      text = `\x1b[1m${text}\x1b[22m`;
    }
    if (this.props.dim) {
      text = `\x1b[2m${text}\x1b[22m`;
    }
    if (this.props.color) {
      text = this.colorize(text, this.props.color);
    }
    
    return text;
  }

  private colorize(text: string, color: string): string {
    const colors: Record<string, string> = {
      black: "\x1b[30m",
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      blue: "\x1b[34m",
      magenta: "\x1b[35m",
      cyan: "\x1b[36m",
      white: "\x1b[37m",
      gray: "\x1b[90m",
    };
    const reset = "\x1b[0m";
    
    return `${colors[color] || ""}${text}${reset}`;
  }
}

export class TUIRenderer {
  private rl: readline.Interface;
  private root: Box | null = null;
  private options: RenderOptions;
  private isRunning = false;
  private inputBuffer = "";
  private messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  private onSubmit?: (text: string) => void;
  private renderTimer: Timer | null = null;
  private lastRender = 0;

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
  }

  private setupInput(): void {
    // 设置 raw mode 以捕获按键
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");

    stdin.on("data", (key: string) => {
      // Ctrl+C
      if (key === "\x03" && this.options.exitOnCtrlC) {
        this.cleanup();
        process.exit(0);
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

  setOnSubmit(callback: (text: string) => void): void {
    this.onSubmit = callback;
  }

  addMessage(role: "user" | "assistant", content: string): void {
    this.messages.push({ role, content });
    this.scheduleRender();
  }

  appendToLastMessage(content: string): void {
    if (this.messages.length === 0) {
      this.messages.push({ role: "assistant", content });
    } else {
      this.messages[this.messages.length - 1].content += content;
    }
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.renderTimer) return;

    const elapsed = Date.now() - this.lastRender;
    
    // 16ms 内批量渲染 (约 60fps)
    if (elapsed < 16) {
      this.renderTimer = setTimeout(() => {
        this.renderTimer = null;
        this.render();
      }, 16);
      return;
    }

    // 立即渲染
    this.render();
  }

  render(): void {
    this.lastRender = Date.now();
    
    // 清屏
    stdout.write("\x1b[2J\x1b[H");

    const width = stdout.columns || 80;
    const height = stdout.rows || 24;

    // 渲染消息区域
    let output = "";
    
    // 标题
    output += new Text({ children: "═".repeat(width - 1), color: "cyan" }).render() + "\n";
    output += new Text({ children: "  Tong Work AI Assistant", bold: true, color: "cyan" }).render() + "\n";
    output += new Text({ children: "═".repeat(width - 1), color: "cyan" }).render() + "\n\n";

    // 消息
    for (const msg of this.messages.slice(-(height - 8))) {
      const roleColor = msg.role === "user" ? "green" : "blue";
      const roleText = msg.role === "user" ? "用户" : "AI";
      
      output += new Text({ children: `${roleText}:`, bold: true, color: roleColor }).render() + "\n";
      
      const lines = msg.content.split("\n");
      for (const line of lines) {
        if (line.length > width - 4) {
          // 长行换行
          for (let i = 0; i < line.length; i += width - 4) {
            output += "  " + line.slice(i, i + width - 4) + "\n";
          }
        } else {
          output += "  " + line + "\n";
        }
      }
      output += "\n";
    }

    // 输入区域分隔线
    output += new Text({ children: "─".repeat(width - 1), color: "gray" }).render() + "\n";
    
    // 输入提示
    output += new Text({ children: "> ", bold: true, color: "green" }).render();
    output += this.inputBuffer;
    output += "\n";
    
    // 帮助提示
    output += new Text({ children: "─".repeat(width - 1), color: "gray" }).render() + "\n";
    output += new Text({ children: "Enter 发送 | Ctrl+C 退出", dim: true, color: "gray" }).render() + "\n";

    stdout.write(output);
  }

  cleanup(): void {
    stdin.setRawMode(false);
    this.rl.close();
    stdout.write("\x1b[?25h"); // 显示光标
  }
}

/**
 * 渲染 TUI 应用
 */
export function renderTUIRoot(
  renderFn: () => Box,
  options: RenderOptions = {}
): () => void {
  const renderer = new TUIRenderer(options);
  
  // 隐藏光标
  stdout.write("\x1b[?25l");
  
  // 初始渲染
  renderer.render();

  // 返回清理函数
  return () => {
    renderer.cleanup();
  };
}

/**
 * 创建盒子组件
 */
export function createBox(props: BoxProps = {}): Box {
  return new Box(props);
}

/**
 * 创建文本组件
 */
export function createText(props: TextProps = {}): Text {
  return new Text(props);
}
