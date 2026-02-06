/**
 * @fileoverview CLIEngine - Interactive Chat Engine
 * 
 * Simple interactive CLI that connects to Server via SSE.
 */

import { AgentClient, type EventHandler } from "./client.js";

export interface CLIEngineOptions {
  serverUrl: string;
  sessionId?: string;
}

export class CLIEngine {
  private client: AgentClient;
  private sessionId: string;
  private isStreaming: boolean = false;
  private firstChunk: boolean = true;
  private isShowingReasoning: boolean = false;
  private isShowingText: boolean = false;
  private currentLineLength: number = 0;
  private pendingMessageId: string | null = null;
  private currentMessageId: string | null = null;
  private isPrompting: boolean = false;

  constructor(options: CLIEngineOptions) {
    this.client = new AgentClient({ baseUrl: options.serverUrl });
    this.sessionId = options.sessionId || this.generateSessionId();
  }

  /**
   * Generate random session ID
   */
  private generateSessionId(): string {
    return `cli_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // Handle stream start
    this.client.on("stream.start", (event) => {
      // Only process events for the current message
      if (this.pendingMessageId && event.properties?.messageId !== this.pendingMessageId) {
        return;
      }
      this.currentMessageId = event.properties?.messageId || null;
      this.firstChunk = true;
      this.isShowingReasoning = false;
      this.isShowingText = false;
      this.currentLineLength = 0;
    });

    // Handle text chunks - main response
    this.client.on("stream.text", (event) => {
      // Only process events for the current message
      if (this.currentMessageId && event.properties?.messageId !== this.currentMessageId) {
        return;
      }

      // If we were showing reasoning, end that line first
      if (this.isShowingReasoning) {
        process.stdout.write("\n");
        this.isShowingReasoning = false;
        this.firstChunk = true;
      }

      if (!this.isShowingText) {
        if (this.firstChunk) {
          process.stdout.write("🤖 ");
          this.firstChunk = false;
        }
        this.isShowingText = true;
      }

      const delta = event.properties?.delta || "";
      process.stdout.write(delta);
      this.currentLineLength += delta.length;
    });

    // Handle reasoning - show as thinking indicator
    this.client.on("stream.reasoning", (event) => {
      // Only process events for the current message
      if (this.currentMessageId && event.properties?.messageId !== this.currentMessageId) {
        return;
      }

      // If transitioning from text to reasoning
      if (this.isShowingText) {
        process.stdout.write("\n");
        this.isShowingText = false;
        this.firstChunk = true;
      }

      if (!this.isShowingReasoning) {
        process.stdout.write("💭 Thinking...");
        this.isShowingReasoning = true;
      }
    });

    // Handle tool calls
    this.client.on("stream.tool.call", (event) => {
      // Only process events for the current message
      if (this.currentMessageId && event.properties?.messageId !== this.currentMessageId) {
        return;
      }

      // End any current stream
      if (this.isShowingReasoning || this.isShowingText) {
        process.stdout.write("\n");
      }
      const toolName = event.properties?.toolName || "unknown";
      console.log(`🔧 [Tool: ${toolName}]`);
      this.isShowingReasoning = false;
      this.isShowingText = false;
    });

    // Handle completion
    this.client.on("stream.completed", (event) => {
      // Only process events for the current message
      if (this.currentMessageId && event.properties?.messageId !== this.currentMessageId) {
        return;
      }

      if (this.isShowingReasoning || this.isShowingText) {
        process.stdout.write("\n");
      }
      this.isStreaming = false;
      this.isShowingReasoning = false;
      this.isShowingText = false;
      this.firstChunk = true;
      this.currentLineLength = 0;
      this.currentMessageId = null;
      this.pendingMessageId = null;
    });

    // Handle errors
    this.client.on("stream.error", (event) => {
      // Only process events for the current message
      if (this.currentMessageId && event.properties?.messageId !== this.currentMessageId) {
        return;
      }

      if (this.isShowingReasoning || this.isShowingText) {
        process.stdout.write("\n");
      }
      this.isStreaming = false;
      const error = event.properties?.error || "Unknown error";
      console.error(`❌ Error: ${error}`);
      this.isShowingReasoning = false;
      this.isShowingText = false;
      this.currentMessageId = null;
      this.pendingMessageId = null;
    });

    // Handle server heartbeat
    this.client.on("server.heartbeat", () => {
      // Silent heartbeat
    });
  }

  /**
   * Prompt for user input
   */
  private async prompt(text: string): Promise<string> {
    // Prevent multiple prompts
    if (this.isPrompting) {
      return "";
    }
    
    this.isPrompting = true;
    
    return new Promise((resolve) => {
      process.stdout.write(text);
      
      const stdin = process.stdin;
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');
      
      let input = '';
      
      const onData = (key: string) => {
        // Ctrl+C or Ctrl+D to exit
        if (key === '\u0003' || key === '\u0004') {
          cleanup();
          process.stdout.write('\n');
          resolve('exit');
          return;
        }
        
        // Enter key
        if (key === '\r' || key === '\n') {
          cleanup();
          process.stdout.write('\n');
          resolve(input.trim());
          return;
        }
        
        // Backspace
        if (key === '\u007f') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.write('\b \b');
          }
          return;
        }
        
        // Normal character
        if (key >= ' ' && key <= '~') {
          input += key;
          process.stdout.write(key);
        }
      };
      
      const cleanup = () => {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        this.isPrompting = false;
      };
      
      stdin.on('data', onData);
    });
  }

  /**
   * Run interactive CLI
   */
  async run(): Promise<void> {
    // Print header
    console.log("╔════════════════════════════════════════════╗");
    console.log("║         🤖 Agent CLI                       ║");
    console.log("╚════════════════════════════════════════════╝");
    console.log(`Server: ${this.client.baseUrl}`);
    console.log(`Session: ${this.sessionId}`);
    console.log("输入 'exit' 或 'quit' 退出\n");

    // Setup event handlers
    this.setupEventHandlers();

    // Connect to SSE
    this.client.connect(this.sessionId);

    // Wait a moment for connection
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Interactive loop
    while (true) {
      // Wait a bit to ensure previous stream is fully completed
      if (this.isStreaming) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      
      const input = await this.prompt("💬 ");

      // Handle empty input
      if (!input) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }

      // Handle exit commands
      if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
        console.log("\n👋 再见!");
        break;
      }

      // Handle clear command
      if (input.toLowerCase() === "clear") {
        console.clear();
        continue;
      }

      // Handle help command
      if (input.toLowerCase() === "help") {
        console.log("\n📖 命令列表:");
        console.log("  <query>  - 发送消息给 AI");
        console.log("  clear    - 清屏");
        console.log("  exit     - 退出程序");
        console.log("  help     - 显示帮助\n");
        continue;
      }

      // Send query
      try {
        // Reset state for new message
        if (this.isShowingReasoning || this.isShowingText) {
          process.stdout.write("\n");
        }
        this.isStreaming = true;
        this.isShowingReasoning = false;
        this.isShowingText = false;
        this.firstChunk = true;
        this.currentLineLength = 0;
        this.currentMessageId = null;
        // Generate a unique message ID for this request
        this.pendingMessageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        await this.client.sendPrompt(this.sessionId, input);

        // Wait for stream to complete
        while (this.isStreaming) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        
        // Small delay before showing next prompt
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (err) {
        console.error("\n❌ Failed to send:", err);
        this.isStreaming = false;
        this.pendingMessageId = null;
        this.currentMessageId = null;
      }
    }

    // Disconnect
    this.client.disconnect();
  }
}
