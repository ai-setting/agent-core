/**
 * @fileoverview AgentClient - SSE Client for Agent Core Server
 * 
 * Connects to Server via SSE and handles event streaming.
 */

import EventSource from "eventsource";

export type EventHandler = (event: any) => void;

export interface AgentClientOptions {
  baseUrl: string;
}

export class AgentClient {
  baseUrl: string;
  private eventSource: EventSource | null = null;
  private handlers: Map<string, EventHandler[]> = new Map();
  private reconnectTimer: Timer | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 30000; // Max 30s
  private baseReconnectDelay = 3000; // Start with 3s
  private sessionId?: string;
  private isConnecting = false;

  constructor(options: AgentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, ""); // Remove trailing slash
  }

  /**
   * Connect to SSE endpoint
   */
  connect(sessionId?: string): void {
    // Prevent concurrent connection attempts
    if (this.isConnecting) {
      return;
    }
    
    this.isConnecting = true;
    this.sessionId = sessionId;
    
    const url = new URL("/events", this.baseUrl);
    if (sessionId) {
      url.searchParams.set("sessionId", sessionId);
    }

    console.log(`🔗 Connecting to ${url.toString()}...`);

    this.eventSource = new EventSource(url.toString());

    this.eventSource.onopen = () => {
      console.log("✅ Connected to server");
      this.reconnectAttempts = 0; // Reset on successful connection
      this.isConnecting = false;
    };

    this.eventSource.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        this.handleEvent(data);
      } catch (err) {
        console.error("Failed to parse event:", e.data);
      }
    };

    this.eventSource.onerror = () => {
      console.error("❌ SSE connection error");
      this.isConnecting = false;
      
      // Auto-reconnect with exponential backoff
      if (!this.reconnectTimer) {
        const delay = Math.min(
          this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
          this.maxReconnectDelay
        );
        this.reconnectAttempts++;
        
        console.log(`🔄 Reconnecting in ${delay}ms... (attempt ${this.reconnectAttempts})`);
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect(this.sessionId);
        }, delay);
      }
    };
  }

  /**
   * Disconnect from SSE
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.isConnecting = false;
    this.eventSource?.close();
    this.eventSource = null;
    console.log("👋 Disconnected from server");
  }

  /**
   * Subscribe to event type
   */
  on(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.handlers.get(eventType);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Handle incoming event
   */
  private handleEvent(event: any): void {
    // Handle specific event type
    const handlers = this.handlers.get(event.type) || [];
    handlers.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        console.error(`Error in handler for ${event.type}:`, err);
      }
    });

    // Handle wildcard
    const wildcardHandlers = this.handlers.get("*") || [];
    wildcardHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        console.error("Error in wildcard handler:", err);
      }
    });
  }

  /**
   * Send prompt to server
   */
  async sendPrompt(sessionId: string, content: string): Promise<void> {
    const url = `${this.baseUrl}/sessions/${sessionId}/prompt`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send prompt: ${response.status} - ${error}`);
    }
  }
}
