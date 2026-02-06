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
 */

import type { Environment, Prompt, HistoryMessage, MessageContent } from "../environment";
import { Event, Context } from "../types";

interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Record<string, unknown>;
  name?: string;
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
  retryDelayMs?: number;
  retryBackoffFactor?: number;
  maxRetryDelayMs?: number;
  doomLoopThreshold?: number;
}

const DEFAULT_CONFIG: Required<AgentConfig> = {
  maxIterations: 100,
  retryDelayMs: 1000,
  retryBackoffFactor: 2,
  maxRetryDelayMs: 30000,
  doomLoopThreshold: 3,
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
  private aborted: boolean = false;
  private _history: HistoryMessage[] = [];

  constructor(
    private event: Event,
    private env: Environment,
    private tools: import("../types").Tool[],
    private prompt: Prompt | undefined,
    private context: Context = {},
    private configOverrides: AgentConfig = {},
    history?: HistoryMessage[],
  ) {
    this.config = { ...DEFAULT_CONFIG, ...configOverrides };
    this._history = history ?? [];
  }

  async run(): Promise<string> {
    if (!this.prompt) {
      throw new Error("System prompt not found");
    }

    this.iteration = 0;
    this.doomLoopCache.clear();
    this.aborted = false;

    const messages: Message[] = [
      { role: "system", content: this.prompt.content },
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
        if (result !== null) {
          return result;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (this.isRetryableError(errorMessage)) {
          const delay = this.calculateRetryDelay(this.iteration);
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
    const llmResult = await this.env.handle_action(
      {
        tool_name: "invoke_llm",
        args: { 
          messages,
          tools: this.tools.length > 0 ? this.tools : undefined,
        },
      },
      this.context
    );

    if (!llmResult.success) {
      const error = llmResult.error || "Unknown LLM error";
      
      if (this.isRetryableError(error)) {
        return null;
      }
      
      throw new Error(`LLM call failed: ${error}`);
    }

    const output = llmResult.output as unknown as LLMOutput;
    const hasToolCalls = output.tool_calls && output.tool_calls.length > 0;

    if (!hasToolCalls) {
      return output.content || "(no response)";
    }

    const toolCalls = output.tool_calls!;

    for (const toolCall of toolCalls) {
      let toolArgs: Record<string, unknown> = {};

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
        if (!isAllowed) {
          messages.push({
            role: "tool",
            content: `Error: Tool "${toolCall.function.name}" is not available. Available tools: ${this.tools.map(t => t.name).join(", ")}`,
            name: toolCall.function.name,
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
      });

      this.updateDoomLoopCache(toolCall.function.name, toolArgs);
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
    ];

    return !nonRetryablePatterns.some((pattern) => error.includes(pattern));
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
  prompt: Prompt | undefined,
  context: Context,
  config?: AgentConfig,
  history?: HistoryMessage[],
): Agent {
  return new Agent(event, env, tools, prompt, context, config, history);
}
