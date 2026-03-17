/**
 * HTTP Client for tong_work Server
 */

export interface Session {
  id: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
}

export interface StreamEvent {
  type: string;
  sessionId?: string;
  messageId?: string;
  content?: string;
  delta?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolCallId?: string;
  result?: unknown;
  success?: boolean;
  error?: string;
  code?: string;
}

export interface StreamDisplayOptions {
  /** 显示 AI 思考过程 (reasoning) */
  reasoning?: boolean;
  /** 显示工具调用 (tool_call) */
  toolCalls?: boolean;
  /** 显示工具执行结果 (tool_result) */
  toolResults?: boolean;
}

export class TongWorkClient {
  private baseUrl: string;
  private sessionId?: string;
  private password?: string;
  private fetchFn: typeof fetch;

  constructor(url: string, options?: { sessionId?: string; password?: string; fetch?: typeof fetch }) {
    this.baseUrl = url.replace(/\/$/, "");
    this.sessionId = options?.sessionId;
    this.password = options?.password;
    this.fetchFn = options?.fetch || fetch;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.password) {
      headers["Authorization"] = `Bearer ${this.password}`;
    }
    return headers;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<Session[]> {
    const res = await this.fetchFn(`${this.baseUrl}/sessions`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`);
    return res.json() as Promise<Session[]>;
  }

  async createSession(title?: string): Promise<Session> {
    const res = await this.fetchFn(`${this.baseUrl}/sessions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
    return res.json() as Promise<Session>;
  }

  async sendPrompt(sessionId: string, content: string): Promise<void> {
    const res = await this.fetchFn(`${this.baseUrl}/sessions/${sessionId}/prompt`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(`Failed to send prompt: ${res.status} - ${err.error ?? 'Unknown error'}`);
    }
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    const res = await this.fetchFn(`${this.baseUrl}/sessions/${sessionId}/messages`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to get messages: ${res.status}`);
    return res.json() as Promise<Message[]>;
  }

  async *streamEvents(sessionId: string): AsyncGenerator<StreamEvent> {
    const url = `${this.baseUrl}/events?session=${encodeURIComponent(sessionId)}`;
    const res = await this.fetchFn(url, {
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Failed to connect to events: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = line.slice(6);
            if (data === "[DONE]") break;
            const event = JSON.parse(data) as StreamEvent;
            yield event;
          } catch {}
        }
      }
    }
  }

  async runInteractive(
    sessionId: string,
    initialMessage: string,
    options?: StreamDisplayOptions
  ): Promise<void> {
    const showReasoning = options?.reasoning ?? true;
    const showToolCalls = options?.toolCalls ?? true;
    const showToolResults = options?.toolResults ?? true;

    await this.sendPrompt(sessionId, initialMessage);

    console.log("\n🤖 AI 响应:\n");

    let lastReasoningContent = "";
    let reasoningLinePrinted = false;

    for await (const event of this.streamEvents(sessionId)) {
      const eventType = this.normalizeEventType(event.type);
      switch (eventType) {
        case "start":
          break;
        case "text":
          process.stdout.write(event.delta || "");
          break;
        case "reasoning":
          if (showReasoning && event.content) {
            if (!reasoningLinePrinted) {
              process.stdout.write("\n💭 思考: ");
              reasoningLinePrinted = true;
            }
            if (event.content === lastReasoningContent) {
              break;
            }
            if (event.content.startsWith(lastReasoningContent)) {
              const newContent = event.content.slice(lastReasoningContent.length);
              if (newContent) {
                process.stdout.write(newContent);
              }
            } else {
              process.stdout.write(event.content);
            }
            lastReasoningContent = event.content;
          }
          break;
        case "tool_call":
          if (showToolCalls) {
            console.log(`\n🔧 调用工具: ${event.toolName}`);
            if (event.toolArgs) {
              console.log("   参数:", JSON.stringify(event.toolArgs, null, 2));
            }
          }
          break;
        case "tool_result":
          if (showToolResults) {
            console.log(`\n📋 工具结果: ${event.toolName}`);
            console.log("   ", typeof event.result === "string" ? event.result : JSON.stringify(event.result, null, 2));
          }
          break;
        case "completed":
          console.log("\n\n✅ 完成\n");
          break;
        case "error":
          console.error("\n❌ 错误:", event.error);
          break;
      }
    }
  }

  private normalizeEventType(type: string): string {
    const mapping: Record<string, string> = {
      "stream.start": "start",
      "stream.text": "text",
      "stream.reasoning": "reasoning",
      "stream.tool.call": "tool_call",
      "stream.tool.result": "tool_result",
      "stream.completed": "completed",
      "stream.error": "error",
    };
    return mapping[type] || type;
  }
}
