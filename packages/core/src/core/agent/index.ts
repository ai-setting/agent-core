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

import type { Environment, MessageContent, BehaviorSpec } from "../environment";
import type { ModelMessage } from "ai";
import { Event, Context } from "../types";

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

  private notifyMessageAdded(message: { role: string; content: string; toolCallId?: string }): void {
    if (this.context.onMessageAdded) {
      this.context.onMessageAdded(message);
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

  async run(systemPrompt: string, userQuery: string): Promise<string> {
    console.log(`[Agent] Starting run with query: "${userQuery.substring(0, 50)}..."`);
    console.log(`[Agent] Available tools: ${this.tools.map(t => t.name).join(", ")}`);
    
    const messages: ModelMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userQuery },
    ];

    let iteration = 0;
    let consecutiveErrors = 0;

    while (iteration < this.config.maxIterations) {
      if (this.isAborted()) {
        console.log("[Agent] Run aborted by user");
        throw new Error("Agent run was aborted");
      }

      iteration++;
      console.log(`[Agent] Iteration ${iteration}/${this.config.maxIterations}`);

      try {
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

        const output = llmResult.output as LLMOutput;
        console.log(`[Agent] LLM output received`, {
          contentLength: output.content?.length || 0,
          hasToolCalls: !!(output.tool_calls && output.tool_calls.length > 0),
          toolCallsCount: output.tool_calls?.length || 0,
        });

        const hasToolCalls = output.tool_calls && output.tool_calls.length > 0;

        if (!hasToolCalls) {
          console.log(`[Agent] No tool calls, returning content: "${output.content}"`);
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
          assistantContent.push({
            type: "tool-call",
            toolCallId: tc.id,
            toolName: tc.function.name,
            args: JSON.parse(tc.function.arguments || "{}"),
          });
        }
        
        messages.push({
          role: "assistant",
          content: assistantContent,
        } as ModelMessage);

        // Notify about assistant message
        this.notifyMessageAdded({ role: "assistant", content: output.content || "" });

        console.log(`[Agent] Processing ${toolCalls.length} tool_calls from LLM`);
        
        for (const toolCall of toolCalls) {
          let toolArgs: Record<string, unknown> = {};

          console.log(`[Agent] Tool call: ${toolCall.function.name}(${toolCall.function.arguments.substring(0, 100)})`);

          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            // JSON parse error - return error result with actual tool name
            const errorMessage = `Invalid JSON in arguments: ${toolCall.function.arguments}`;
            messages.push({
              role: "tool",
              content: [{ type: "tool-result", result: `Error: ${errorMessage}` }],
              toolCallId: toolCall.id,
            } as ModelMessage);
            this.notifyMessageAdded({ role: "tool", content: `Error: ${errorMessage}`, toolCallId: toolCall.id });
            continue;
          }

          if (this.isDoomLoop(toolCall.function.name, toolArgs)) {
            // Doom loop detected - return error result so LLM can try a different approach
            const errorMessage = `Doom loop detected: tool "${toolCall.function.name}" has been called ${this.config.doomLoopThreshold} times with the same arguments. Please try a different approach or use a different tool to achieve your goal.`;
            messages.push({
              role: "tool",
              content: [{ type: "tool-result", result: `Error: ${errorMessage}` }],
              toolCallId: toolCall.id,
            } as ModelMessage);
            this.notifyMessageAdded({ role: "tool", content: `Error: ${errorMessage}`, toolCallId: toolCall.id });
            // Clear the doom loop cache so next attempt can proceed
            this.doomLoopCache.clear();
            continue;
          }

          // Check if tool is allowed (if tools list is provided)
          if (this.tools.length > 0) {
            const isAllowed = this.tools.some(t => t.name === toolCall.function.name);
            console.log(`[Agent] Tool ${toolCall.function.name} allowed: ${isAllowed}`);
            if (!isAllowed) {
              console.log(`[Agent] Rejecting tool call for ${toolCall.function.name}`);
              const errorMessage = `Tool "${toolCall.function.name}" is not available. Available tools: ${this.tools.map(t => t.name).join(", ")}`;
              messages.push({
                role: "tool",
                content: [{ type: "tool-result", result: `Error: ${errorMessage}` }],
                toolCallId: toolCall.id,
              } as ModelMessage);
              this.notifyMessageAdded({ role: "tool", content: `Error: ${errorMessage}`, toolCallId: toolCall.id });
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
            console.warn(`Tool "${toolCall.function.name}" threw error: ${errorMessage}`);
            return {
              success: false,
              output: "",
              error: errorMessage,
              metadata: {},
            };
          });

          if (!toolResult.success) {
            const error = toolResult.error || "Unknown tool error";
            console.warn(`Tool "${toolCall.function.name}" failed: ${error}`);
            
            messages.push({
              role: "tool",
              content: [{ type: "tool-result", result: `Error: ${error}` }],
              toolCallId: toolCall.id,
            } as ModelMessage);
            this.notifyMessageAdded({ role: "tool", content: `Error: ${error}`, toolCallId: toolCall.id });
            
            continue;
          }

          const toolOutputText = typeof toolResult.output === "string"
            ? toolResult.output
            : JSON.stringify(toolResult.output);
          messages.push({
            role: "tool",
            content: [{ type: "tool-result", result: toolOutputText }],
            toolCallId: toolCall.id,
          } as ModelMessage);
          this.notifyMessageAdded({ 
            role: "tool", 
            content: toolOutputText,
            toolCallId: toolCall.id
          });

          console.log(`[Agent] Tool ${toolCall.function.name} completed successfully`);
        }

        console.log(`[Agent] Completed processing all tool_calls, continuing to next iteration`);

      } catch (error) {
        consecutiveErrors++;
        
        if (this.isAborted()) {
          console.log("[Agent] Run aborted during error handling");
          throw new Error("Agent run was aborted");
        }

        console.error(`[Agent] Error in iteration ${iteration}:`, error);

        if (consecutiveErrors >= this.config.maxErrorRetries) {
          console.error(`[Agent] Max consecutive errors (${this.config.maxErrorRetries}) exceeded`);
          return `Error: Max error retries (${this.config.maxErrorRetries}) exceeded. Last error: ${error instanceof Error ? error.message : String(error)}`;
        }

        const delay = this.getRetryDelay(consecutiveErrors - 1);
        console.log(`[Agent] Retrying after ${delay}ms (attempt ${consecutiveErrors}/${this.config.maxErrorRetries})`);
        await this.delay(delay);
      }
    }

    console.log(`[Agent] Max iterations (${this.config.maxIterations}) reached`);
    return `Error: Max iterations (${this.config.maxIterations}) reached without completion`;
  }
}
