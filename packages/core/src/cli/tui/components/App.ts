/**
 * @fileoverview TUI App 组件
 * 
 * 主应用组件，管理状态和事件处理
 */

import { TUIRenderer } from "../renderer";
import { EventStreamManager } from "../hooks/useEventStream";
import type { TUIMessage, TUIStreamEvent, TUIOptions } from "../types";

export class TUIApp {
  private renderer: TUIRenderer;
  private eventManager: EventStreamManager;
  private options: TUIOptions;
  private messages: TUIMessage[] = [];
  private isStreaming = false;
  private currentAssistantMessage: TUIMessage | null = null;
  private lastReasoningContent = ""; // 记录上一次的 reasoning 内容
  private isFirstReasoning = true; // 是否是第一个 reasoning 事件
  private hasReasoningContent = false; // 是否有过 reasoning 内容

  constructor(options: TUIOptions) {
    this.options = options;
    
    this.renderer = new TUIRenderer({
      exitOnCtrlC: true,
    });

    this.eventManager = new EventStreamManager({
      url: options.url,
      sessionId: options.sessionID,
      password: options.password,
      onEvent: (event) => this.handleEvent(event),
      onError: (error) => this.handleError(error),
      onConnect: () => this.handleConnect(),
      onDisconnect: () => this.handleDisconnect(),
    });

    this.renderer.setOnSubmit((text) => this.handleUserInput(text));
  }

  /**
   * 启动 TUI 应用
   */
  async start(): Promise<void> {
    // 显示启动信息
    console.clear();
    console.log("正在连接到服务器...");
    console.log(`服务器地址: ${this.options.url}`);
    
    if (this.options.sessionID) {
      console.log(`会话 ID: ${this.options.sessionID}`);
    }

    console.log("\n按任意键继续...");
    
    // 等待用户按键
    await this.waitForKey();
    
    // 连接到事件流
    this.eventManager.connect();
    
    // 如果没有会话ID，创建新会话
    if (!this.options.sessionID) {
      try {
        const sessionId = await this.eventManager.createSession("TUI Session");
        this.options.sessionID = sessionId;
        this.addSystemMessage(`已创建新会话: ${sessionId}`);
      } catch (error) {
        this.addSystemMessage(`创建会话失败: ${(error as Error).message}`);
      }
    }

    // 初始渲染
    this.renderer.render();
  }

  /**
   * 停止 TUI 应用
   */
  stop(): void {
    this.eventManager.disconnect();
    this.renderer.cleanup();
  }

  private handleUserInput(content: string): void {
    // 添加用户消息
    this.addUserMessage(content);
    
    // 发送到服务器
    this.eventManager.sendMessage(content, this.options.sessionID)
      .then(() => {
        this.isStreaming = true;
      })
      .catch((error) => {
        this.addSystemMessage(`发送失败: ${(error as Error).message}`);
      });
  }

  private handleEvent(event: TUIStreamEvent): void {
    // 忽略心跳和连接事件
    if (event.type === "server.heartbeat") {
      return;
    }

    switch (event.type) {
      case "stream.start":
        this.isStreaming = true;
        this.startAssistantMessage();
        break;
        
      case "stream.text":
        if (event.delta) {
          // 如果之前有 reasoning 内容，先添加换行分隔
          if (this.hasReasoningContent) {
            this.appendToAssistantMessage("\n\n");
            this.hasReasoningContent = false;
          }
          this.appendToAssistantMessage(event.delta);
        }
        break;
        
      case "stream.reasoning":
        if (event.content) {
          // 计算增量：新内容减去旧内容
          const newContent = event.content;
          if (newContent.length > this.lastReasoningContent.length) {
            const delta = newContent.slice(this.lastReasoningContent.length);
            if (this.isFirstReasoning) {
              this.appendToAssistantMessage(`\n\x1b[90mThinking: ${delta}\x1b[0m`);
              this.isFirstReasoning = false;
            } else {
              this.appendToAssistantMessage(`\x1b[90m${delta}\x1b[0m`);
            }
            this.lastReasoningContent = newContent;
            this.hasReasoningContent = true;
          }
        }
        break;
        
      case "stream.tool.call":
        if (event.toolName) {
          this.appendToAssistantMessage(`\n\x1b[33m⚡ ${event.toolName}\x1b[0m`);
          if (event.toolArgs && Object.keys(event.toolArgs).length > 0) {
            this.appendToAssistantMessage(` \x1b[90m${JSON.stringify(event.toolArgs)}\x1b[0m`);
          }
        }
        break;
        
      case "stream.tool.result":
        if (event.toolName) {
          const resultStr = typeof event.result === 'string' 
            ? event.result 
            : JSON.stringify(event.result);
          // 截断过长的结果
          const displayResult = resultStr.length > 100 
            ? resultStr.substring(0, 100) + '...' 
            : resultStr;
          this.appendToAssistantMessage(`\n\x1b[32m✓ ${event.toolName}\x1b[0m \x1b[90m${displayResult}\x1b[0m\n`);
        }
        break;
        
      case "stream.completed":
        this.isStreaming = false;
        this.finalizeAssistantMessage();
        break;
        
      case "stream.error":
        this.isStreaming = false;
        this.addSystemMessage(`错误: ${event.error || "Unknown error"}`);
        break;
    }
    
    // 重新渲染
    this.syncToRenderer();
  }

  private handleError(error: Error): void {
    this.addSystemMessage(`连接错误: ${error.message}`);
  }

  private handleConnect(): void {
    this.addSystemMessage("已连接到服务器");
  }

  private handleDisconnect(): void {
    this.addSystemMessage("与服务器的连接已断开");
  }

  private addUserMessage(content: string): void {
    const message: TUIMessage = {
      id: this.generateId(),
      role: "user",
      content,
      timestamp: Date.now(),
    };
    
    this.messages.push(message);
    this.renderer.addMessage("user", content);
  }

  private startAssistantMessage(): void {
    this.currentAssistantMessage = {
      id: this.generateId(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    };
    // 重置 reasoning 状态
    this.lastReasoningContent = "";
    this.isFirstReasoning = true;
    this.hasReasoningContent = false;
    // 立即添加空消息到渲染器，以便后续追加
    this.renderer.addMessage("assistant", "");
  }

  private appendToAssistantMessage(content: string): void {
    if (!this.currentAssistantMessage) {
      this.startAssistantMessage();
    }
    
    this.currentAssistantMessage!.content += content;
    this.renderer.appendToLastMessage(content);
  }

  private finalizeAssistantMessage(): void {
    if (this.currentAssistantMessage) {
      this.messages.push(this.currentAssistantMessage);
      this.currentAssistantMessage = null;
    }
  }

  private addSystemMessage(content: string): void {
    this.renderer.addMessage("assistant", `[系统] ${content}`);
  }

  private syncToRenderer(): void {
    // 渲染器已经通过 addMessage 和 appendToLastMessage 更新了
    // 这里可以添加额外的状态同步逻辑
  }

  private generateId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private waitForKey(): Promise<void> {
    return new Promise((resolve) => {
      const handler = () => {
        process.stdin.removeListener("data", handler);
        resolve();
      };
      process.stdin.once("data", handler);
    });
  }
}

/**
 * 创建 TUI 应用实例
 */
export function createTUIApp(options: TUIOptions): TUIApp {
  return new TUIApp(options);
}
