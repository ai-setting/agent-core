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

export class TongWorkClient {
  private baseUrl: string;
  private sessionId?: string;
  private password?: string;

  constructor(url: string, options?: { sessionId?: string; password?: string }) {
    this.baseUrl = url.replace(/\/$/, "");
    this.sessionId = options?.sessionId;
    this.password = options?.password;
  }

  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (this.password) {
      headers["Authorization"] = `Bearer ${this.password}`;
    }
    return headers;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<Session[]> {
    const res = await fetch(`${this.baseUrl}/sessions`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to list sessions: ${res.status}`);
    return res.json();
  }

  async createSession(title?: string): Promise<Session> {
    const res = await fetch(`${this.baseUrl}/sessions`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
    return res.json();
  }

  async sendPrompt(sessionId: string, content: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/prompt`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Failed to send prompt: ${res.status} - ${err.error}`);
    }
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/messages`, {
      headers: this.getHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to get messages: ${res.status}`);
    return res.json();
  }

  async *streamEvents(sessionId: string): AsyncGenerator<StreamEvent> {
    const url = `${this.baseUrl}/events?session=${encodeURIComponent(sessionId)}`;
    const res = await fetch(url, {
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

  async runInteractive(sessionId: string, initialMessage: string): Promise<void> {
    await this.sendPrompt(sessionId, initialMessage);

    console.log("\n🤖 AI 响应:\n");

    for await (const event of this.streamEvents(sessionId)) {
      switch (event.type) {
        case "start":
          break;
        case "text":
          process.stdout.write(event.delta || "");
          break;
        case "reasoning":
          console.log("\n💭 思考:", event.content);
          break;
        case "tool_call":
          console.log(`\n🔧 调用工具: ${event.toolName}`);
          if (event.toolArgs) {
            console.log("   参数:", JSON.stringify(event.toolArgs, null, 2));
          }
          break;
        case "tool_result":
          console.log(`\n📋 工具结果: ${event.toolName}`);
          console.log("   ", event.result);
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
}
