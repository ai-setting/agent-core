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

import type { Environment, HistoryMessage, MessageContent, BehaviorSpec } from "../environment";
import { Event, Context } from "../types";

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Record<string, unknown>;
  name?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

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
  doomLoopThreshold: 3,
  agentId: "system",
};

interface DoomLoopEntry {
  toolName: string;
  inputHash: string;
  count: number;
}

function convertContent(content: MessageContent | MessageContent[]): string | Record<string, unknown> {
  if (Array.isArray(content)) {
    return content.map(c => {
      if (c.type === "text") return { type: "text", text: c.text };
      return c as unknown as Record<string, unknown>;
    }) as unknown as Record<string, unknown>;
  }
  if (content.type === "text") return content.text;
  return content as unknown as Record<string, unknown>;
}

export class Agent {
  private config: Required<AgentConfig>;
  private doomLoopCache: Map<string, DoomLoopEntry> = new Map();
  private iteration: number = 0;
  private errorRetryCount: number = 0;
  private aborted: boolean = false;
  private _history: HistoryMessage[] = [];
  private tools: import("../types").Tool[];
  private agentId: string;

  constructor(
    private event: Event,
    private env: Environment,
    tools: import("../types").Tool[],
    private context: Context = {},
    configOverrides: AgentConfig = {},
    history?: HistoryMessage[],
  ) {
    this.config = { ...DEFAULT_CONFIG, ...configOverrides };
    this.agentId = this.config.agentId;
    this._history = history ?? [];
    this.tools = tools;
    console.log(`[Agent] Agent ID: ${this.agentId}`);
    console.log(`[Agent] Registered tools: ${this.tools.map(t => t.name).join(", ") || "none"}`);
  }

  async run(): Promise<string> {
    this.iteration = 0;
    this.doomLoopCache.clear();
    this.aborted = false;

    // 从 Environment 获取该 agent 的行为规范
    const behaviorSpec = await this.getBehaviorSpec();
    const systemPrompt = behaviorSpec.combinedPrompt;

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      ...this._history.map(h => ({
        role: h.role as Message["role"],
        content: convertContent(h.content),
        name: h.name,
      })),
      { role: "user", content: this.formatEvent(this.event) },
    ];

    while (this.iteration < this.config.maxIterations) {
      this.iteration++;

      if (this.context.abort?.aborted) {
        throw new Error("Agent execution aborted");
      }

      try {
        const result = await this.executeIteration(messages);
        console.log(`[Agent] executeIteration returned: ${result === null ? 'null' : typeof result + ' (length: ' + result.length + ')'}`);
        if (result !== null) {
          console.log(`[Agent] Returning result from run(): "${result.substring(0, 50)}..."`);
          return result;
        }
        console.log(`[Agent] Result was null, continuing to next iteration`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (this.isRetryableError(errorMessage)) {
          this.errorRetryCount++;
          
          if (this.errorRetryCount > this.config.maxErrorRetries) {
            throw new Error(`Max error retries (${this.config.maxErrorRetries}) exceeded. Last error: ${errorMessage}`);
          }
          
          const delay = this.calculateRetryDelay(this.errorRetryCount);
          console.warn(`Transient error on iteration ${this.iteration}, retrying in ${delay}ms: ${errorMessage}`);
          await this.sleep(delay);
          continue;
        }

        throw error;
      }
    }

    throw new Error("Max iterations exceeded");
  }

  private async executeIteration(messages: Message[]): Promise<string | null> {
    console.log(`[Agent] executeIteration - Available tools: ${this.tools.map(t => t.name).join(", ") || "none"}`);
    
    // Use native LLM capability instead of tool invocation
    const llmResult = await this.env.invokeLLM(
      messages,
      this.tools.length > 0 ? this.tools : undefined,
      this.context
    );

    console.log(`[Agent] LLM result success: ${llmResult.success}, has error: ${!!llmResult.error}`);
    
    if (!llmResult.success) {
      const error = llmResult.error || "Unknown LLM error";
      console.log(`[Agent] LLM call failed with error: ${error}`);
      
      if (this.isRetryableError(error)) {
        this.errorRetryCount++;
        
        if (this.errorRetryCount > this.config.maxErrorRetries) {
          throw new Error(`Max error retries (${this.config.maxErrorRetries}) exceeded. Last error: ${error}`);
        }
        
        console.log(`[Agent] Error is retryable (attempt ${this.errorRetryCount}/${this.config.maxErrorRetries}), returning null`);
        return null;
      }
      
      throw new Error(`LLM call failed: ${error}`);
    }

    console.log(`[Agent] LLM result type: ${typeof llmResult.output}, success: ${llmResult.success}`);
    console.log(`[Agent] LLM output raw:`, JSON.stringify(llmResult.output, null, 2));
    console.log(`[Agent] LLM output keys: ${Object.keys(llmResult.output || {}).join(", ")}`);
    
    const output = llmResult.output as unknown as LLMOutput;
    console.log(`[Agent] After cast - output.content: "${output.content}", type: ${typeof output.content}`);
    console.log(`[Agent] After cast - output.tool_calls:`, output.tool_calls);
    const hasToolCalls = output.tool_calls && output.tool_calls.length > 0;

    console.log(`[Agent] LLM returned - hasToolCalls: ${hasToolCalls}, content length: ${(output.content || "").length}`);
    console.log(`[Agent] Output content preview: ${(output.content || "").substring(0, 100)}`);

    if (!hasToolCalls) {
      console.log(`[Agent] No tool calls, returning content: "${output.content}"`);
      return output.content || "(no response)";
    }

    const toolCalls = output.tool_calls!;
    console.log(`[Agent] Processing ${toolCalls.length} tool_calls: ${toolCalls.map(tc => tc.function.name).join(", ")}`);

    // Push assistant message with reasoning and tool_calls (for models like Kimi)
    // Kimi requires reasoning_content when thinking is enabled
    messages.push({
      role: "assistant",
      content: output.content || "",
      reasoning_content: output.reasoning,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
    } as Message);

    console.log(`[Agent] Processing ${toolCalls.length} tool_calls from LLM`);
    
    for (const toolCall of toolCalls) {
      let toolArgs: Record<string, unknown> = {};

      console.log(`[Agent] Tool call: ${toolCall.function.name}(${toolCall.function.arguments.substring(0, 100)})`);

      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch {
        throw new Error(
          `Invalid tool arguments for ${toolCall.function.name}: ${toolCall.function.arguments}`
        );
      }

      if (this.isDoomLoop(toolCall.function.name, toolArgs)) {
        throw new Error(
          `Doom loop detected: tool "${toolCall.function.name}" called ${this.config.doomLoopThreshold} times with same arguments`
        );
      }

      // Check if tool is allowed (if tools list is provided)
      if (this.tools.length > 0) {
        const isAllowed = this.tools.some(t => t.name === toolCall.function.name);
        console.log(`[Agent] Tool ${toolCall.function.name} allowed: ${isAllowed}`);
        if (!isAllowed) {
          console.log(`[Agent] Rejecting tool call for ${toolCall.function.name}`);
          messages.push({
            role: "tool",
            content: `Error: Tool "${toolCall.function.name}" is not available. Available tools: ${this.tools.map(t => t.name).join(", ")}`,
            name: toolCall.function.name,
            tool_call_id: toolCall.id,
          });
          continue;
        }
      }

      const toolResult = await this.env.handle_action(
        {
          tool_name: toolCall.function.name,
          args: toolArgs,
        },
        this.context
      );

      if (!toolResult.success) {
        const error = toolResult.error || "Unknown tool error";
        console.warn(`Tool "${toolCall.function.name}" failed: ${error}`);
        
        messages.push({
          role: "tool",
          content: `Error: ${error}`,
          name: toolCall.function.name,
          tool_call_id: toolCall.id,
        });
        
        continue;
      }

      messages.push({
        role: "tool",
        content:
          typeof toolResult.output === "string"
            ? toolResult.output
            : JSON.stringify(toolResult.output),
        name: toolCall.function.name,
        tool_call_id: toolCall.id,
      });

      this.updateDoomLoopCache(toolCall.function.name, toolArgs);
    }

    // Reset error retry count on successful iteration (tool calls were processed)
    if (this.errorRetryCount > 0) {
      console.log(`[Agent] Resetting error retry count after successful tool execution`);
      this.errorRetryCount = 0;
    }

    return null;
  }

  private isRetryableError(error: string): boolean {
    const nonRetryablePatterns = [
      "Tool not found",
      "Permission denied",
      "File not found",
      "Invalid tool arguments",
      "Doom loop detected",
      "Invalid JSON",
      "Parse error",
      "401",
      "Invalid Authentication",
      "Unauthorized",
      "API key",
    ];

    return !nonRetryablePatterns.some((pattern) => 
      error.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  private calculateRetryDelay(attempt: number): number {
    const delay = this.config.retryDelayMs * Math.pow(this.config.retryBackoffFactor, attempt - 1);
    return Math.min(delay, this.config.maxRetryDelayMs);
  }

  private isDoomLoop(toolName: string, args: Record<string, unknown>): boolean {
    const key = this.getDoomLoopKey(toolName, args);
    const entry = this.doomLoopCache.get(key);

    if (entry) {
      entry.count++;
      return entry.count >= this.config.doomLoopThreshold;
    }

    this.doomLoopCache.set(key, {
      toolName,
      inputHash: key,
      count: 1,
    });

    return false;
  }

  private updateDoomLoopCache(toolName: string, args: Record<string, unknown>): void {
    const key = this.getDoomLoopKey(toolName, args);
    const entry = this.doomLoopCache.get(key);

    if (entry) {
      entry.count++;
    }
  }

  private getDoomLoopKey(toolName: string, args: Record<string, unknown>): string {
    const normalizedArgs = this.normalizeArgs(args);
    return `${toolName}:${JSON.stringify(normalizedArgs)}`;
  }

  private normalizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const normalized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (typeof value === "object" && value !== null) {
        normalized[key] = this.sortObject(value as Record<string, unknown>);
      } else {
        normalized[key] = value;
      }
    }

    return normalized;
  }

  private sortObject(obj: Record<string, unknown>): Record<string, unknown> {
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();

    for (const key of keys) {
      const value = obj[key];
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        sorted[key] = this.sortObject(value as Record<string, unknown>);
      } else {
        sorted[key] = value;
      }
    }

    return sorted;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private formatEvent(event: Event): string {
    const content =
      typeof event.content === "string"
        ? event.content
        : JSON.stringify(event.content, null, 2);
    return `[${event.event_type}]\n${content}`;
  }

  /**
   * 获取该 agent 的行为规范
   */
  private async getBehaviorSpec(): Promise<BehaviorSpec> {
    if (!this.env.getBehaviorSpec) {
      throw new Error("Environment does not support getBehaviorSpec");
    }
    return this.env.getBehaviorSpec(this.agentId);
  }

  getIterationCount(): number {
    return this.iteration;
  }

  reset(): void {
    this.iteration = 0;
    this.doomLoopCache.clear();
    this.aborted = false;
  }
}

export function createAgent(
  event: Event,
  env: Environment,
  tools: import("../types").Tool[],
  context: Context,
  config?: AgentConfig,
  history?: HistoryMessage[],
): Agent {
  return new Agent(event, env, tools, context, config, history);
}
