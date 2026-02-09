/**
 * @fileoverview TUI App
 */

import { createRenderer } from "../solid-renderer";
import { EventStreamManager } from "../hooks/useEventStream";
import { store, storeActions } from "../store";
import type { TUIStreamEvent, TUIOptions, Message, MessagePart } from "../types";

export class TUIApp {
  private renderer: ReturnType<typeof createRenderer>;
  private eventManager: EventStreamManager;
  private options: TUIOptions;
  private currentMessageId?: string;

  constructor(options: TUIOptions) {
    this.options = options;

    this.renderer = createRenderer();

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
    console.clear();
    console.log("正在连接到服务器...");
    console.log(`服务器地址: ${this.options.url}`);

    if (this.options.sessionID) {
      console.log(`会话 ID: ${this.options.sessionID}`);
    }

    console.log("\n按任意键继续...");
    await this.waitForKey();

    // Set session ID
    if (this.options.sessionID) {
      storeActions.setSessionId(this.options.sessionID);
    }

    // Mount renderer
    this.renderer.mount();

    // Connect event stream
    this.eventManager.connect();

    // Create session if needed
    if (!this.options.sessionID) {
      try {
        const sessionId = await this.eventManager.createSession("TUI Session");
        this.options.sessionID = sessionId;
        storeActions.setSessionId(sessionId);
        this.addSystemMessage("已创建新会话");
      } catch (error) {
        this.addSystemMessage(`创建会话失败: ${(error as Error).message}`);
      }
    }
  }

  stop(): void {
    this.eventManager.disconnect();
    this.renderer.cleanup();
  }

  private handleUserInput(content: string): void {
    this.addUserMessage(content);

    this.eventManager
      .sendMessage(content, this.options.sessionID)
      .then(() => {
        storeActions.setStreaming(true);
      })
      .catch((error) => {
        this.addSystemMessage(`发送失败: ${(error as Error).message}`);
      });
  }

  private handleEvent(event: TUIStreamEvent): void {
    if (event.type === "server.heartbeat") return;

    switch (event.type) {
      case "stream.start":
        storeActions.setStreaming(true);
        this.startAssistantMessage();
        break;

      case "stream.text":
      case "stream.reasoning":
        const textContent = event.content || event.delta;
        if (textContent) {
          this.updateTextPart(event.type, textContent);
        }
        break;

      case "stream.tool.call":
        if (event.toolName) {
          this.addToolCall(event);
        }
        break;

      case "stream.tool.result":
        if (event.toolName) {
          this.addToolResult(event);
          
          if (event.toolName === "invoke_llm" && event.result) {
            const result = event.result as { content?: string; reasoning?: string };
            if (result.reasoning) {
              this.updateTextPart("stream.reasoning", result.reasoning);
            }
            if (result.content) {
              this.updateTextPart("stream.text", result.content);
            }
          }
        }
        break;

      case "stream.completed":
        storeActions.setStreaming(false);
        this.currentMessageId = undefined;
        break;

      case "stream.error":
        storeActions.setStreaming(false);
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
      id: this.generateId("msg"),
      role: "user",
      content,
      timestamp: Date.now(),
    };

    storeActions.addMessage(message);
  }

  private startAssistantMessage(): void {
    const messageId = this.generateId("msg");
    this.currentMessageId = messageId;
    
    const message: Message = {
      id: messageId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      parts: [],
    };

    storeActions.addMessage(message);
  }

  private updateTextPart(eventType: string, content: string): void {
    if (!this.currentMessageId) return;

    const isReasoning = eventType === "stream.reasoning";
    const partType = isReasoning ? "reasoning" : "text";

    const parts = store.parts[this.currentMessageId] || [];
    const existingPart = parts.find((p) => p.type === partType);

    const part: MessagePart = {
      id: existingPart?.id || this.generateId("part"),
      type: partType,
      content: content,
      timestamp: Date.now(),
    };

    storeActions.updatePart(this.currentMessageId, part);
  }

  private addToolCall(event: TUIStreamEvent): void {
    if (!this.currentMessageId) return;

    const part: MessagePart = {
      id: this.generateId("part"),
      type: "tool_call",
      toolName: event.toolName,
      toolArgs: event.toolArgs,
      timestamp: Date.now(),
    };

    storeActions.updatePart(this.currentMessageId, part);
  }

  private addToolResult(event: TUIStreamEvent): void {
    if (!this.currentMessageId) return;

    const part: MessagePart = {
      id: this.generateId("part"),
      type: "tool_result",
      toolName: event.toolName,
      result: event.result,
      success: event.success,
      timestamp: Date.now(),
    };

    storeActions.updatePart(this.currentMessageId, part);
  }

  private addSystemMessage(content: string): void {
    const message: Message = {
      id: this.generateId("msg"),
      role: "system",
      content,
      timestamp: Date.now(),
    };

    storeActions.addMessage(message);
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private waitForKey(): Promise<void> {
    return new Promise((resolve) => {
      process.stdin.once("data", () => resolve());
    });
  }
}

export function createTUIApp(options: TUIOptions): TUIApp {
  return new TUIApp(options);
}
