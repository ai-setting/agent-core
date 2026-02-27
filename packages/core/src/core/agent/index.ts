/**
 * @fileoverview Enhanced Agent implementation with comprehensive error handling and optimization.
 *
 * Features:
 * - Doom loop detection
 * - Exponential backoff retry for transient errors
 * - Graceful degradation on tool errors
 * - Abort signal support
 * - Detailed error logging
 * - Multimodal history support
 * - BehaviorSpec support (env rules + agent prompt)
 */

import { createLogger } from "../../utils/logger.js";
import type { Environment, MessageContent, BehaviorSpec } from "../environment";
import type { ModelMessage } from "ai";
import { Event, Context } from "../types";

const agentLogger = createLogger("agent", "server.log");

// Note: Using ModelMessage from 'ai' SDK directly

interface LLMOutput {
  content: string;
  reasoning?: string;
  tool_calls?: Array<{
    id: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface AgentConfig {
  maxIterations?: number;
  maxErrorRetries?: number;
  retryDelayMs?: number;
  retryBackoffFactor?: number;
  maxRetryDelayMs?: number;
  doomLoopThreshold?: number;
  /** Agent ID（用于获取特定的行为规范） */
  agentId?: string;
}

const DEFAULT_CONFIG: Required<AgentConfig> = {
  maxIterations: 100,
  maxErrorRetries: 3,
  retryDelayMs: 1000,
  retryBackoffFactor: 2,
  maxRetryDelayMs: 30000,
  doomLoopThreshold: 5,
  agentId: "system",
};

export class Agent {
  private config: Required<AgentConfig>;
  private retryCount: Map<string, number> = new Map();
  private doomLoopCache: Map<string, number> = new Map();
  private aborted: boolean = false;
  private _history: ModelMessage[] = [];
  private tools: import("../types").Tool[];
  private agentId: string;

  private notifyMessageAdded(message: { role: string; content: string; toolCallId?: string; name?: string }): void {
    if (this.context.onMessageAdded) {
      // Map camelCase to snake_case for tool messages to match expected format
      const mappedMessage: any = { ...message };
      if (message.toolCallId) {
        mappedMessage.tool_call_id = message.toolCallId;
        delete mappedMessage.toolCallId;
      }
      this.context.onMessageAdded(mappedMessage);
    }
  }

  constructor(
    private event: Event,
    private env: Environment,
    tools: import("../types").Tool[],
    private context: Context = {},
    configOverrides: AgentConfig = {},
    history?: ModelMessage[],
  ) {
    this.config = { ...DEFAULT_CONFIG, ...configOverrides };
    this.tools = tools;
    this.agentId = configOverrides.agentId || DEFAULT_CONFIG.agentId;
    if (history) {
      this._history = history;
    }
  }

  get history(): ModelMessage[] {
    return this._history;
  }

  abort(): void {
    this.aborted = true;
    console.log("[Agent] Abort signal received");
  }

  private isAborted(): boolean {
    return this.aborted;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getRetryDelay(retryCount: number): number {
    const delay = Math.min(
      this.config.retryDelayMs * Math.pow(this.config.retryBackoffFactor, retryCount),
      this.config.maxRetryDelayMs
    );
    return delay;
  }

  private isDoomLoop(toolName: string, toolArgs: Record<string, unknown>): boolean {
    const key = `${toolName}:${JSON.stringify(toolArgs)}`;
    const count = this.doomLoopCache.get(key) || 0;
    this.doomLoopCache.set(key, count + 1);
    return count >= this.config.doomLoopThreshold;
  }

  async run(systemPrompt?: string, userQuery?: string): Promise<string> {
    // Extract user query from event content if not provided
    const query = userQuery ?? (typeof this.event.content === "string" ? this.event.content : JSON.stringify(this.event.content));
    
    // Get system prompt from behavior spec if not provided
    let prompt = systemPrompt;
    if (!prompt && this.env.getBehaviorSpec) {
      try {
        const spec = await this.env.getBehaviorSpec(this.agentId);
        prompt = spec.combinedPrompt;
      } catch (e) {
        console.warn("[Agent] Failed to get behavior spec:", e);
        prompt = "You are a helpful assistant.";
      }
    }
    prompt = prompt ?? "You are a helpful assistant.";
    
    agentLogger.info(`Starting run with query: "${query.substring(0, 50)}..."`);
    agentLogger.info(`Available tools: ${this.tools.map(t => t.name).join(", ")}`);
    agentLogger.info(`History count: ${this._history.length}`);
    
    const messages: ModelMessage[] = [
      { role: "system", content: prompt },
      ...this._history,
      { role: "user", content: query },
    ];

    agentLogger.info(`===== FINAL MESSAGES FOR LLM =====`);
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      agentLogger.info(`Message ${i}: role=${m.role}, contentType=${typeof m.content}, isArray=${Array.isArray(m.content)}`);
      if (typeof m.content === 'string') {
        agentLogger.info(`  content: ${m.content.substring(0, 100)}`);
      } else if (Array.isArray(m.content)) {
        agentLogger.info(`  content: ${JSON.stringify(m.content).substring(0, 200)}`);
      } else {
        agentLogger.info(`  content: ${JSON.stringify(m.content).substring(0, 200)}`);
      }
    }
    agentLogger.info(`=========================================`);

    let iteration = 0;
    let consecutiveErrors = 0;

    while (iteration < this.config.maxIterations) {
    if (this.isAborted()) {
      agentLogger.info("Run aborted by user");
      throw new Error("Agent run was aborted");
    }

    iteration++;
    agentLogger.info(`Iteration ${iteration}/${this.config.maxIterations}`);

      try {
        agentLogger.info(`===== INVOKING LLM (iteration ${iteration}) =====`);
        for (let i = 0; i < messages.length; i++) {
          const m = messages[i];
          agentLogger.info(`LLM Message ${i}: role=${m.role}, contentType=${typeof m.content}, isArray=${Array.isArray(m.content)}`);
          if (typeof m.content === 'string') {
            agentLogger.info(`  content: ${m.content.substring(0, 100)}`);
          } else if (Array.isArray(m.content)) {
            agentLogger.info(`  content: ${JSON.stringify(m.content).substring(0, 200)}`);
          }
        }
        
        const llmResult = await this.env.invokeLLM(
          messages,
          this.tools,
          this.context,
          { temperature: 0.7, maxTokens: 4000 }
        );

        consecutiveErrors = 0;

        if (!llmResult.success) {
          console.error(`[Agent] LLM call failed: ${llmResult.error}`);
          return `Error: ${llmResult.error}`;
        }

        const output = llmResult.output as unknown as LLMOutput;
        agentLogger.info(`LLM output received`, {
          contentLength: output.content?.length || 0,
          hasToolCalls: !!(output.tool_calls && output.tool_calls.length > 0),
          toolCallsCount: output.tool_calls?.length || 0,
        });

        const hasToolCalls = output.tool_calls && output.tool_calls.length > 0;

        if (!hasToolCalls) {
          agentLogger.info(`No tool calls, returning content: "${output.content}"`);
          this.notifyMessageAdded({ role: "assistant", content: output.content || "" });
          return output.content || "(no response)";
        }

        const toolCalls = output.tool_calls!;
        console.log(`[Agent] Processing ${toolCalls.length} tool_calls: ${toolCalls.map(tc => tc.function.name).join(", ")}`);

        // Build assistant message with content array containing text and tool-call parts
        const assistantContent: any[] = [];
        
        // Add text content if present
        if (output.content) {
          assistantContent.push({ type: "text", text: output.content });
        }
        
        // Add reasoning as text part if present
        if (output.reasoning) {
          assistantContent.push({ type: "text", text: `<think>${output.reasoning}</think>` });
        }
        
        // Add tool calls as tool-call parts
        for (const tc of toolCalls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments || "{}");
          } catch {
            // If JSON parsing fails, use empty args
            agentLogger.warn(`Failed to parse tool arguments for ${tc.function.name}: ${tc.function.arguments}`);
          }
          assistantContent.push({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.function.name,
            input: parsedArgs,  // AI SDK expects 'input', not 'args'
          });
        }
        
        messages.push({
          role: "assistant",
          content: assistantContent,
        } as ModelMessage);

        // Notify about assistant message
        this.notifyMessageAdded({ role: "assistant", content: output.content || "" });

        agentLogger.info(`Processing ${toolCalls.length} tool_calls from LLM`);
        agentLogger.info(`Assistant message built:`, JSON.stringify({
          role: "assistant",
          content: assistantContent,
        }, null, 2));
        
        for (const toolCall of toolCalls) {
          let toolArgs: Record<string, unknown> = {};

          agentLogger.info(`Tool call: ${toolCall.function.name}(${toolCall.function.arguments.substring(0, 100)})`);

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            // JSON parse error - return error result with actual tool name
            const errorMessage = `Invalid JSON in arguments: ${toolCall.function.arguments}`;
            messages.push({
              role: "tool",
              content: [{ type: "tool-result", toolCallId: toolCall.id, toolName: toolCall.function.name, output: { type: "text", value: `Error: ${errorMessage}` } }],
              toolCallId: toolCall.id,  // Required by AI SDK at message level
            } as ModelMessage);
            this.notifyMessageAdded({ role: "tool", content: `Error: ${errorMessage}`, toolCallId: toolCall.id, name: toolCall.function.name });
            continue;
          }

          if (this.isDoomLoop(toolCall.function.name, toolArgs)) {
            // Doom loop detected - return error result so LLM can try a different approach
            const errorMessage = `Doom loop detected: tool "${toolCall.function.name}" has been called ${this.config.doomLoopThreshold} times with the same arguments. Please try a different approach or use a different tool to achieve your goal.`;
            messages.push({
              role: "tool",
              content: [{ type: "tool-result", toolCallId: toolCall.id, toolName: toolCall.function.name, output: { type: "text", value: `Error: ${errorMessage}` } }],
              toolCallId: toolCall.id,  // Required by AI SDK at message level
            } as ModelMessage);
            this.notifyMessageAdded({ role: "tool", content: `Error: ${errorMessage}`, toolCallId: toolCall.id, name: toolCall.function.name });
            // Clear the doom loop cache so next attempt can proceed
            this.doomLoopCache.clear();
            continue;
          }

          // Check if tool is allowed (if tools list is provided)
          if (this.tools.length > 0) {
            const isAllowed = this.tools.some(t => t.name === toolCall.function.name);
            agentLogger.info(`Tool ${toolCall.function.name} allowed: ${isAllowed}`);
            if (!isAllowed) {
              agentLogger.info(`Rejecting tool call for ${toolCall.function.name}`);
              const errorMessage = `Tool "${toolCall.function.name}" is not available. Available tools: ${this.tools.map(t => t.name).join(", ")}`;
            messages.push({
              role: "tool",
              content: [{ type: "tool-result", toolCallId: toolCall.id, toolName: toolCall.function.name, output: { type: "text", value: `Error: ${errorMessage}` } }],
            } as ModelMessage);
            this.notifyMessageAdded({ role: "tool", content: `Error: ${errorMessage}`, toolCallId: toolCall.id, name: toolCall.function.name });
              continue;
            }
          }

          const toolResult = await this.env.handle_action(
            {
              tool_name: toolCall.function.name,
              args: toolArgs,
            },
            this.context
          ).catch((error) => {
            const errorMessage = error instanceof Error ? error.message : String(error);
            agentLogger.warn(`Tool "${toolCall.function.name}" threw error: ${errorMessage}`);
            return {
              success: false,
              output: "",
              error: errorMessage,
              metadata: {},
            };
          });

          if (!toolResult.success) {
            const error = toolResult.error || "Unknown tool error";
            agentLogger.warn(`Tool "${toolCall.function.name}" failed: ${error}`);
            
            messages.push({
              role: "tool",
              content: [{ type: "tool-result", toolCallId: toolCall.id, toolName: toolCall.function.name, output: { type: "text", value: `Error: ${error}` } }],
              toolCallId: toolCall.id,  // Required by AI SDK at message level
            } as ModelMessage);
            this.notifyMessageAdded({ role: "tool", content: `Error: ${error}`, toolCallId: toolCall.id });
            
            continue;
          }

          const toolOutputText = typeof toolResult.output === "string"
            ? toolResult.output
            : JSON.stringify(toolResult.output);
          messages.push({
            role: "tool",
            content: [{ type: "tool-result", toolCallId: toolCall.id, toolName: toolCall.function.name, output: { type: "text", value: toolOutputText } }],
            toolCallId: toolCall.id,  // Required by AI SDK at message level
          } as ModelMessage);
          this.notifyMessageAdded({ 
            role: "tool", 
            content: toolOutputText,
            toolCallId: toolCall.id,
            name: toolCall.function.name
          });

          agentLogger.info(`Tool ${toolCall.function.name} completed successfully`);
          agentLogger.info(`Tool message built:`, JSON.stringify({
            role: "tool",
            content: [{ type: "tool-result", toolCallId: toolCall.id, toolName: toolCall.function.name, output: { type: "text", value: toolOutputText } }],
          }, null, 2));
        }

        agentLogger.info(`Completed processing all tool_calls, continuing to next iteration`);
        
        // Debug: 打印所有消息的详细信息
        agentLogger.info(`=== DEBUG: All messages before invokeLLM ===`);
        for (let i = 0; i < messages.length; i++) {
          const m = messages[i];
          agentLogger.info(`Message ${i} [${m.role}]:`, {
            contentType: typeof m.content,
            isArray: Array.isArray(m.content),
            hasToolCallId: !!(m as any).toolCallId,
          });
          if (m.role === "tool" && (m as any).toolCallId) {
            const toolContent = (m as any).content;
            agentLogger.info(`  Tool message content:`, JSON.stringify(toolContent).substring(0, 500));
          }
        }
        agentLogger.info(`============================================`);

      } catch (error) {
        consecutiveErrors++;
        
        if (this.isAborted()) {
          agentLogger.info("Run aborted during error handling");
          throw new Error("Agent run was aborted");
        }

        agentLogger.error(`Error in iteration ${iteration}:`, error);

        if (consecutiveErrors >= this.config.maxErrorRetries) {
          agentLogger.error(`Max consecutive errors (${this.config.maxErrorRetries}) exceeded`);
          return `Error: Max error retries (${this.config.maxErrorRetries}) exceeded. Last error: ${error instanceof Error ? error.message : String(error)}`;
        }

        const delay = this.getRetryDelay(consecutiveErrors - 1);
        agentLogger.info(`Retrying after ${delay}ms (attempt ${consecutiveErrors}/${this.config.maxErrorRetries})`);
        await this.delay(delay);
      }
    }

    agentLogger.info(`Max iterations (${this.config.maxIterations}) reached`);
    return `Error: Max iterations (${this.config.maxIterations}) reached without completion`;
  }
}
