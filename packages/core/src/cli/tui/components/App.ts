/**
 * @fileoverview TUI App 组件
 * 
 * 参考 OpenCode 设计的主应用组件
 */

import { TUIRenderer, type Message, type MessagePart } from "../renderer";
import { EventStreamManager } from "../hooks/useEventStream";
import type { TUIStreamEvent, TUIOptions } from "../types";

export class TUIApp {
  private renderer: TUIRenderer;
  private eventManager: EventStreamManager;
  private options: TUIOptions;
  private messages: Message[] = [];
  private isStreaming = false;
  private currentAssistantMessage: Message | null = null;
  private lastReasoningContent = "";
  private isFirstReasoning = true;
  private hasReasoningContent = false;
  private currentParts: MessagePart[] = [];

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

  async start(): Promise<void> {
    // 显示启动信息
    console.clear();
    console.log("正在连接到服务器...");
    console.log(`服务器地址: ${this.options.url}`);
    
    if (this.options.sessionID) {
      console.log(`会话 ID: ${this.options.sessionID}`);
    }

    console.log("\n按任意键继续...");
    
    await this.waitForKey();
    
    this.eventManager.connect();
    
    if (!this.options.sessionID) {
      try {
        const sessionId = await this.eventManager.createSession("TUI Session");
        this.options.sessionID = sessionId;
        this.renderer.setSessionTitle(`Session ${sessionId.slice(0, 8)}`);
        this.addSystemMessage(`已创建新会话`);
      } catch (error) {
        this.addSystemMessage(`创建会话失败: ${(error as Error).message}`);
      }
    } else {
      this.renderer.setSessionTitle(`Session ${this.options.sessionID.slice(0, 8)}`);
    }

    this.renderer.render();
  }

  stop(): void {
    this.eventManager.disconnect();
    this.renderer.cleanup();
  }

  private handleUserInput(content: string): void {
    this.addUserMessage(content);
    
    this.eventManager.sendMessage(content, this.options.sessionID)
      .then(() => {
        this.isStreaming = true;
        this.renderer.setStreaming(true);
      })
      .catch((error) => {
        this.addSystemMessage(`发送失败: ${(error as Error).message}`);
      });
  }

  private handleEvent(event: TUIStreamEvent): void {
    if (event.type === "server.heartbeat") {
      return;
    }

    switch (event.type) {
      case "stream.start":
        this.isStreaming = true;
        this.renderer.setStreaming(true);
        this.startAssistantMessage();
        break;
        
      case "stream.text":
        if (event.delta) {
          // 查找或创建 text part
          let textPart = this.currentParts.find(p => p.type === "text");
          if (!textPart) {
            // 如果之前有 reasoning 内容，在文本前添加换行
            const prefix = this.hasReasoningContent ? "\n\n" : "";
            textPart = { type: "text", content: prefix, delta: "" };
            this.currentParts.push(textPart);
            this.hasReasoningContent = false;
          }
          textPart.delta = event.delta;
          textPart.content = (textPart.content || "") + event.delta;
          
          this.appendToAssistantMessage(event.delta);
          this.updateRendererParts();
        }
        break;
        
      case "stream.reasoning":
        if (event.content) {
          const newContent = event.content;
          if (newContent.length > this.lastReasoningContent.length) {
            const delta = newContent.slice(this.lastReasoningContent.length);
            
            // 查找或创建 reasoning part
            let reasoningPart = this.currentParts.find(p => p.type === "reasoning");
            if (!reasoningPart) {
              reasoningPart = { type: "reasoning", content: "" };
              this.currentParts.push(reasoningPart);
            }
            reasoningPart.content = newContent;
            
            this.lastReasoningContent = newContent;
            this.hasReasoningContent = true;
            this.updateRendererParts();
          }
        }
        break;
        
      case "stream.tool.call":
        if (event.toolName) {
          this.currentParts.push({
            type: "tool_call",
            toolName: event.toolName,
            toolArgs: event.toolArgs,
          });
          this.updateRendererParts();
        }
        break;
        
      case "stream.tool.result":
        if (event.toolName) {
          this.currentParts.push({
            type: "tool_result",
            toolName: event.toolName,
            result: event.result,
            success: event.success,
          });
          this.updateRendererParts();
        }
        break;
        
      case "stream.completed":
        this.isStreaming = false;
        this.renderer.setStreaming(false);
        this.finalizeAssistantMessage();
        break;
        
      case "stream.error":
        this.isStreaming = false;
        this.renderer.setStreaming(false);
        this.addSystemMessage(`错误: ${event.error || "Unknown error"}`);
        break;
    }
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
    const message: Message = {
      id: this.generateId(),
      role: "user",
      content,
      timestamp: Date.now(),
    };
    
    this.messages.push(message);
    this.renderer.addMessage(message);
  }

  private startAssistantMessage(): void {
    this.currentAssistantMessage = {
      id: this.generateId(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      parts: [],
    };
    
    this.lastReasoningContent = "";
    this.isFirstReasoning = true;
    this.hasReasoningContent = false;
    this.currentParts = [];
    
    this.renderer.addMessage(this.currentAssistantMessage);
  }

  private appendToAssistantMessage(content: string): void {
    if (!this.currentAssistantMessage) {
      this.startAssistantMessage();
    }
    
    this.currentAssistantMessage!.content += content;
  }

  private updateRendererParts(): void {
    if (this.currentAssistantMessage) {
      this.currentAssistantMessage.parts = [...this.currentParts];
      this.renderer.updateLastMessageParts(this.currentAssistantMessage.parts);
    }
  }

  private finalizeAssistantMessage(): void {
    if (this.currentAssistantMessage) {
      this.messages.push(this.currentAssistantMessage);
      this.currentAssistantMessage = null;
    }
  }

  private addSystemMessage(content: string): void {
    const message: Message = {
      id: this.generateId(),
      role: "system",
      content,
      timestamp: Date.now(),
    };
    
    this.messages.push(message);
    this.renderer.addMessage(message);
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

export function createTUIApp(options: TUIOptions): TUIApp {
  return new TUIApp(options);
}
