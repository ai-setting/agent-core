/**
 * @fileoverview Base environment implementation with LLM integration.
 * Provides core functionality for agent environments.
 */

import { z } from "zod";
import { Environment, Prompt, StreamEvent, HistoryMessage } from "../index.js";
import {
  Context,
  Action,
  ToolResult,
  Tool,
  ToolInfo,
  LLMStream,
  LLMStreamEvent,
  StreamHandler,
  ToolContext,
} from "../../types/index.js";
import { Agent } from "../../agent/index.js";
import {
  TimeoutManager,
  RetryManager,
  ConcurrencyManager,
  ErrorRecovery,
  DefaultMetricsCollector,
  AggregatedMetrics,
} from "./index.js";
import { createInvokeLLM, createSystem1IntuitiveReasoning, type InvokeLLMConfig } from "./invoke-llm.js";

export interface BaseEnvironmentConfig {
  timeoutManager?: TimeoutManager;
  retryManager?: RetryManager;
  concurrencyManager?: ConcurrencyManager;
  errorRecovery?: ErrorRecovery;
  metricsCollector?: DefaultMetricsCollector;
  maxConcurrentStreams?: number;
  defaultTimeoutMs?: number;
  defaultConcurrencyLimit?: number;
  defaultMaxRetries?: number;
  defaultModel?: string;
  systemPrompt?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  /**
   * Hook for handling stream events from LLM
   * Called during invoke_llm streaming response
   */
  onStreamEvent?: (event: StreamEvent, context: Context) => void | Promise<void>;
}

export interface ToolRegistration {
  tool: Tool;
  isNew: boolean;
}

export abstract class BaseEnvironment implements Environment {
  protected tools: Map<string, Tool> = new Map();
  protected toolCategories: Map<string, Set<string>> = new Map();
  protected prompts: Map<string, Prompt> = new Map();
  protected streams: Map<string, LLMStream> = new Map();
  protected streamHandlers: Set<StreamHandler> = new Set();
  protected timeoutManager: TimeoutManager;
  protected retryManager: RetryManager;
  protected concurrencyManager: ConcurrencyManager;
  protected errorRecovery: ErrorRecovery;
  protected metrics: DefaultMetricsCollector;
  protected maxConcurrentStreams: number;
  protected defaultModel: string;
  protected systemPrompt: string;
  private initializationPromise: Promise<void> | null = null;
  private modelToInitialize: string | undefined;
  private baseURLToInitialize: string | undefined;
  private apiKeyToInitialize: string | undefined;

  constructor(config?: BaseEnvironmentConfig) {
    this.timeoutManager = config?.timeoutManager ?? TimeoutManager.default();
    this.retryManager = config?.retryManager ?? RetryManager.default();
    this.concurrencyManager = config?.concurrencyManager ?? ConcurrencyManager.default();
    this.errorRecovery = config?.errorRecovery ?? ErrorRecovery.default();
    this.metrics = config?.metricsCollector ?? new DefaultMetricsCollector();
    this.maxConcurrentStreams = config?.maxConcurrentStreams ?? 10;
    this.defaultModel = config?.defaultModel ?? "gpt-4";
    this.systemPrompt = config?.systemPrompt ?? "";

    // Set stream event hook from config
    if (config?.onStreamEvent) {
      this.onStreamEvent = config.onStreamEvent;
    }

    if (this.systemPrompt) {
      this.addPrompt({ id: "system", content: this.systemPrompt });
    }

    if (config?.model) {
      this.modelToInitialize = config.model;
      this.baseURLToInitialize = config.baseURL;
      this.apiKeyToInitialize = config.apiKey;
      this.initializationPromise = this.initializeLLM();
    }
  }

  private async initializeLLM(): Promise<void> {
    if (this.modelToInitialize) {
      await this.configureLLMWithModel(this.modelToInitialize, this.baseURLToInitialize, this.apiKeyToInitialize);
    }
  }

  private async ensureLLMInitialized(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
      this.initializationPromise = null;
    }
  }

  protected async configureLLMWithModel(model: string, baseURL?: string, apiKey?: string): Promise<void> {
    const { createLLMConfigFromEnv } = await import("./invoke-llm.js");
    const config = createLLMConfigFromEnv(model);
    if (config) {
      this.configureLLM(config);
    }
  }

  registerTool(tool: Tool | ToolInfo): ToolRegistration {
    const toolInfo = "execute" in tool ? tool : this.toolToToolInfo(tool);
    const name = toolInfo.name;
    const existing = this.tools.has(name);

    this.tools.set(name, toolInfo);

    return {
      tool: toolInfo,
      isNew: !existing,
    };
  }

  unregisterTool(name: string): boolean {
    const removed = this.tools.delete(name);

    for (const [category, tools] of this.toolCategories) {
      tools.delete(name);
      if (tools.size === 0) {
        this.toolCategories.delete(category);
      }
    }

    return removed;
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  findTools(category: string): Tool[] {
    const toolNames = this.toolCategories.get(category);
    if (!toolNames) return [];
    return Array.from(toolNames)
      .map((name) => this.tools.get(name))
      .filter((t): t is Tool => t !== undefined);
  }

  listTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getPrompt(promptId: string): Prompt | undefined {
    return this.prompts.get(promptId);
  }

  getTools(): Tool[] {
    return this.listTools();
  }

  addPrompt(prompt: Prompt): void {
    this.prompts.set(prompt.id, prompt);
  }

  subscribe(handler: StreamHandler): void {
    this.streamHandlers.add(handler);
  }

  unsubscribe(handler: StreamHandler): void {
    this.streamHandlers.delete(handler);
  }

  getStream(streamId: string): LLMStream | undefined {
    return this.streams.get(streamId);
  }

  pushToSubscribers(event: LLMStreamEvent): void {
    for (const handler of this.streamHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  protected createLLMStream(streamId: string): LLMStream {
    const queue: LLMStreamEvent[] = [];
    let resolver: (() => void) | null = null;
    let closed = false;

    const stream: LLMStream = {
      id: streamId,
      events: (async function* (): AsyncGenerator<LLMStreamEvent, void, unknown> {
        while (true) {
          while (queue.length > 0) {
            const event = queue.shift()!;
            if (event.type === "completed" || event.type === "error") {
              return;
            }
            yield event;
          }
          if (closed) return;
          await new Promise<void>((resolve) => {
            resolver = resolve;
          });
          resolver = null;
        }
      })(),
      push: (event: LLMStreamEvent): void => {
        if (closed) return;
        queue.push(event);
        if (resolver) {
          resolver();
          resolver = null;
        }
      },
      complete: (): void => {
        if (closed) return;
        closed = true;
        queue.push({ type: "completed" });
        if (resolver) {
          resolver();
          resolver = null;
        }
      },
      error: (error: string): void => {
        if (closed) return;
        closed = true;
        queue.push({ type: "error", content: error });
        if (resolver) {
          resolver();
          resolver = null;
        }
      },
    };

    this.streams.set(streamId, stream);
    return stream;
  }

  async handle_query(query: string, context?: Context, history?: HistoryMessage[]): Promise<string> {
    await this.ensureLLMInitialized();

    const event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user" as const,
      content: query,
    };

    let prompt = this.getPrompt("system");
    if (!prompt) {
      prompt = { id: "default", content: "You are a helpful AI assistant." };
      this.addPrompt(prompt);
    }

    const agent = new Agent(event, this as Environment, this.listTools(), prompt, context ?? {}, undefined, history);
    return agent.run();
  }

  async handle_action(action: Action, ctx: Context): Promise<ToolResult> {
    const startTime = Date.now();
    const tool = this.getTool(action.tool_name);

    if (!tool) {
      const result: ToolResult = {
        success: false,
        output: "",
        error: `Tool not found: ${action.tool_name}`,
        metadata: {
          execution_time_ms: Date.now() - startTime,
        },
      };
      this.metrics.record(action.tool_name, result);
      return result;
    }

    const slotResult = await this.concurrencyManager.acquireSlot(action.tool_name);
    if (!slotResult.acquired) {
      const result: ToolResult = {
        success: false,
        output: "",
        error: `Failed to acquire concurrency slot for tool: ${action.tool_name}`,
        metadata: {
          execution_time_ms: Date.now() - startTime,
        },
      };
      this.metrics.record(action.tool_name, result);
      return result;
    }

    try {
      this.emitStreamEvent({
        type: "tool_call",
        tool_name: action.tool_name,
        tool_args: action.args,
      }, ctx);

      const result = await this.errorRecovery.executeWithRecovery(
        async () => {
          const timeout = this.timeoutManager.getTimeout(action.tool_name, action);
          return this.executeWithTimeout(tool, action, ctx, timeout);
        },
        action.tool_name,
        action.action_id ?? `action_${Date.now()}`,
        action.args,
      );

      this.metrics.record(action.tool_name, result);
      return result;
    } finally {
      if (slotResult.slotId !== undefined) {
        this.concurrencyManager.releaseSlot(action.tool_name, slotResult.slotId);
      }
    }
  }

  private async executeWithTimeout(
    tool: Tool,
    action: Action,
    context: Context,
    timeoutMs: number,
  ): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool execution timeout: ${action.tool_name}`));
      }, timeoutMs);

      const abortHandler = (): void => {
        clearTimeout(timer);
        reject(new Error("Tool execution aborted"));
      };

      if (context.abort) {
        context.abort.addEventListener("abort", abortHandler);
      }

      // Pass env instance to tool context
      const toolContext = this.toToolContext(context);
      (toolContext as any).env = this;

      Promise.resolve(tool.execute(action.args, toolContext))
        .then((result) => {
          clearTimeout(timer);
          if (context.abort) {
            context.abort.removeEventListener("abort", abortHandler);
          }
          this.emitStreamEvent({
            type: "tool_result",
            tool_name: action.tool_name,
            tool_result: result.output,
            metadata: result.metadata,
          }, context);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          if (context.abort) {
            context.abort.removeEventListener("abort", abortHandler);
          }
          this.emitStreamEvent({
            type: "error",
            content: error instanceof Error ? error.message : String(error),
            tool_name: action.tool_name,
          }, context);
          reject(error);
        });
    });
  }

  private toToolContext(context: Context): ToolContext {
    return {
      workdir: context.workdir,
      user_id: context.user_id,
      session_id: context.session_id,
      abort: context.abort,
      metadata: {
        ...context.metadata,
        session_id: context.session_id,
        message_id: context.message_id,
      },
    };
  }

  private toolToToolInfo(tool: ToolInfo): Tool {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: tool.execute.bind(tool),
    };
  }

  getMetrics(toolName?: string): Map<string, AggregatedMetrics> {
    if (toolName) {
      const metrics = this.metrics.getMetrics(toolName);
      if (metrics) {
        const map = new Map<string, AggregatedMetrics>();
        map.set(toolName, metrics);
        return map;
      }
      return new Map();
    }
    return this.metrics.getAllMetrics();
  }

  resetMetrics(): void {
    this.metrics.reset();
  }

  getConcurrencyStatus(
    toolName?: string,
  ): Map<string, { active: number; waiting: number; limit: number }> {
    if (toolName) {
      const status = new Map<string, { active: number; waiting: number; limit: number }>();
      status.set(toolName, {
        active: this.concurrencyManager.getActiveCount(toolName),
        waiting: this.concurrencyManager.getWaitQueueLength(toolName),
        limit: this.concurrencyManager.getConcurrencyLimit(toolName),
      });
      return status;
    }

    const allStatus = new Map<string, { active: number; waiting: number; limit: number }>();
    for (const [name] of this.tools) {
      allStatus.set(name, {
        active: this.concurrencyManager.getActiveCount(name),
        waiting: this.concurrencyManager.getWaitQueueLength(name),
        limit: this.concurrencyManager.getConcurrencyLimit(name),
      });
    }
    return allStatus;
  }

  configureLLM(config: InvokeLLMConfig): void {
    const invokeLlmTool = createInvokeLLM(config);
    this.registerTool(invokeLlmTool);

    const system1Tool = createSystem1IntuitiveReasoning(config);
    this.registerTool(system1Tool);
  }

  protected abstract getDefaultTimeout(toolName: string): number;
  protected abstract getTimeoutOverride(action: Action): number | undefined;
  protected abstract getMaxRetries(toolName: string): number;
  protected abstract getRetryDelay(toolName: string): number;
  protected abstract isRetryableError(error: string): boolean;
  protected abstract getConcurrencyLimit(toolName: string): number;
  protected abstract getRecoveryStrategy(toolName: string): {
    type: "retry" | "fallback" | "skip" | "error";
    maxRetries?: number;
    fallbackTool?: string;
  };

  onStreamEvent?(event: StreamEvent, context: Context): void | Promise<void>;

  protected emitStreamEvent(event: StreamEvent, context: Context): void | Promise<void> {
    if (this.onStreamEvent) {
      return this.onStreamEvent(event, context);
    }
  }
}
