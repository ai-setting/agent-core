/**
 * @fileoverview SSE 事件流管理 Hook
 */

import { EventSource } from "eventsource";
import type { TUIStreamEvent, TUIStreamEventRaw } from "../types";
import { normalizeEvent } from "../types";

export interface EventStreamOptions {
  url: string;
  sessionId?: string;
  password?: string;
  onEvent?: (event: TUIStreamEvent) => void;
  onError?: (error: Error) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export class EventStreamManager {
  private eventSource: EventSource | null = null;
  private options: EventStreamOptions;
  private reconnectTimer: Timer | null = null;
  private isConnecting = false;
  private shouldReconnect = true;

  // 事件批处理
  private eventQueue: TUIStreamEvent[] = [];
  private flushTimer: Timer | null = null;
  private lastFlush = 0;

  constructor(options: EventStreamOptions) {
    this.options = options;
  }

  /**
   * 连接到 SSE 服务器
   */
  connect(): void {
    if (this.isConnecting || this.eventSource) {
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;

    try {
      let url = new URL("/events", this.options.url);
      if (this.options.sessionId) {
        url.searchParams.set("session", this.options.sessionId);
      }

      // 如果设置了密码，将 token 编码到 URL 中（因为 EventSource 不支持自定义 headers）
      if (this.options.password) {
        url.searchParams.set("token", this.options.password);
      }

      this.eventSource = new EventSource(url.toString());

      this.setupEventHandlers();
    } catch (error) {
      this.isConnecting = false;
      this.options.onError?.(error as Error);
      this.scheduleReconnect();
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.clearFlushTimer();

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.isConnecting = false;
    this.options.onDisconnect?.();
  }

  /**
   * 发送消息到服务器
   */
  async sendMessage(content: string, sessionId?: string): Promise<void> {
    const sid = sessionId || this.options.sessionId;
    if (!sid) {
      throw new Error("No session ID provided");
    }

    const response = await fetch(`${this.options.url}/sessions/${sid}/prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.options.password && {
          Authorization: `Bearer ${this.options.password}`,
        }),
      },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(
        `Failed to send message: ${response.status} - ${errorData.error || "Unknown error"}`
      );
    }
  }

  /**
   * 创建新会话
   */
  async createSession(title?: string): Promise<string> {
    const response = await fetch(`${this.options.url}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.options.password && {
          Authorization: `Bearer ${this.options.password}`,
        }),
      },
      body: JSON.stringify({ title }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status}`);
    }

    const data = await response.json() as { id: string };
    return data.id;
  }

  private setupEventHandlers(): void {
    if (!this.eventSource) return;

    this.eventSource.onopen = () => {
      this.isConnecting = false;
      this.options.onConnect?.();
    };

    this.eventSource.onmessage = (e) => {
      try {
        const raw = JSON.parse(e.data) as TUIStreamEventRaw;
        // 将原始事件转换为扁平化格式
        const data = normalizeEvent(raw);
        this.handleEvent(data);
      } catch (error) {
        console.error("[TUI] Failed to parse event:", error);
      }
    };

    this.eventSource.onerror = () => {
      this.isConnecting = false;
      this.options.onError?.(new Error("SSE connection error"));
      this.scheduleReconnect();
    };
  }

  private handleEvent(event: TUIStreamEvent): void {
    // 将事件加入队列
    this.eventQueue.push(event);

    const elapsed = Date.now() - this.lastFlush;

    // 如果已经有定时器，不再创建新的
    if (this.flushTimer) return;

    // 16ms 内批量处理 (约 60fps)
    if (elapsed < 16) {
      this.flushTimer = setTimeout(() => this.flush(), 16);
      return;
    }

    // 立即处理
    this.flush();
  }

  private flush(): void {
    if (this.eventQueue.length === 0) return;

    const events = [...this.eventQueue];
    this.eventQueue = [];
    this.flushTimer = null;
    this.lastFlush = Date.now();

    // 批量处理事件
    for (const event of events) {
      this.options.onEvent?.(event);
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer) return;

    // 3秒后重连
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // 清空剩余事件
    this.flush();
  }
}

/**
 * 创建事件流管理器
 */
export function createEventStream(options: EventStreamOptions): EventStreamManager {
  return new EventStreamManager(options);
}
