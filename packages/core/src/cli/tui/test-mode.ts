/**
 * @fileoverview TUI Test Mode - 模拟输入测试
 * 
 * 支持自动化测试 TUI 功能
 * 通过 TUI_TEST_INPUTS 环境变量设置模拟输入
 */

import { tuiLogger } from "./logger.js";

export interface TestInput {
  type: "text" | "delay" | "exit";
  value?: string;
  delayMs?: number;
}

/**
 * 解析测试输入
 * 格式: "hello;delay:1000;world;exit"
 */
export function parseTestInputs(input?: string): TestInput[] {
  if (!input) return [];
  
  const parts = input.split(";");
  const inputs: TestInput[] = [];
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    
    if (trimmed === "exit") {
      inputs.push({ type: "exit" });
    } else if (trimmed.startsWith("delay:")) {
      const delayMs = parseInt(trimmed.slice(6), 10);
      if (!isNaN(delayMs)) {
        inputs.push({ type: "delay", delayMs });
      }
    } else {
      inputs.push({ type: "text", value: trimmed });
    }
  }
  
  return inputs;
}

/**
 * 测试模式控制器
 */
export class TestModeController {
  private inputs: TestInput[];
  private currentIndex = 0;
  private onInput: (input: string) => void;
  private onExit: () => void;
  private isRunning = false;

  constructor(onInput: (input: string) => void, onExit: () => void) {
    this.inputs = parseTestInputs(process.env.TUI_TEST_INPUTS);
    this.onInput = onInput;
    this.onExit = onExit;
    
    if (this.inputs.length > 0) {
      tuiLogger.info("Test mode enabled", { inputs: this.inputs });
    }
  }

  /**
   * 是否启用了测试模式
   */
  isEnabled(): boolean {
    return this.inputs.length > 0;
  }

  /**
   * 开始执行测试输入
   */
  async start(): Promise<void> {
    if (this.isRunning || !this.isEnabled()) return;
    
    this.isRunning = true;
    tuiLogger.info("Starting test mode execution");

    // 等待 TUI 初始化完成
    await this.delay(1000);

    for (this.currentIndex = 0; this.currentIndex < this.inputs.length; this.currentIndex++) {
      if (!this.isRunning) break;
      
      const input = this.inputs[this.currentIndex];
      tuiLogger.info("Executing test input", { 
        index: this.currentIndex, 
        type: input.type,
        value: input.value?.slice(0, 50)
      });

      switch (input.type) {
        case "text":
          if (input.value) {
            this.onInput(input.value);
            // 等待响应
            await this.delay(2000);
          }
          break;
        case "delay":
          await this.delay(input.delayMs || 1000);
          break;
        case "exit":
          tuiLogger.info("Test mode exit requested");
          this.onExit();
          return;
      }
    }

    tuiLogger.info("Test mode execution completed");
    this.isRunning = false;
  }

  /**
   * 停止测试
   */
  stop(): void {
    this.isRunning = false;
    tuiLogger.info("Test mode stopped");
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 创建测试模式控制器
 */
export function createTestMode(onInput: (input: string) => void, onExit: () => void): TestModeController {
  return new TestModeController(onInput, onExit);
}

/**
 * 获取测试输入示例
 */
export function getTestInputExamples(): string[] {
  return [
    "hello",
    "hello;delay:2000;how are you",
    "hello;delay:1000;what can you do;delay:3000;exit",
  ];
}
