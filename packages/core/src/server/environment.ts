/**
 * @fileoverview ServerEnvironment - Environment with EventBus integration
 *
 * Extends BaseEnvironment to publish stream events via EventBus.
 */

import {
  BaseEnvironment,
  BaseEnvironmentConfig,
} from "../core/environment/base/base-environment.js";
import type { Context } from "../core/types/context.js";
import type { Action } from "../core/types/action.js";
import type { StreamEvent } from "../core/environment/index.js";
import * as Bus from "./eventbus/bus.js";
import {
  StreamStartEvent,
  StreamTextEvent,
  StreamReasoningEvent,
  StreamToolCallEvent,
  StreamToolResultEvent,
  StreamCompletedEvent,
  StreamErrorEvent,
} from "./eventbus/events/stream.js";

export interface ServerEnvironmentConfig extends BaseEnvironmentConfig {
  sessionId?: string;
}

export class ServerEnvironment extends BaseEnvironment {
  private sessionId: string;
  private toolsRegistered: Promise<void>;

  constructor(config?: ServerEnvironmentConfig) {
    const envConfig: BaseEnvironmentConfig = {
      ...config,
      onStreamEvent: (event: StreamEvent, context: Context) => {
        this.handleStreamEvent(event, context);
      },
    };

    super(envConfig);
    this.sessionId = config?.sessionId || "default";

    this.toolsRegistered = this.registerDefaultTools();
  }

  async waitForReady(): Promise<void> {
    // Wait for base class LLM initialization
    await (this as any).ensureLLMInitialized?.();
    // Wait for tools registration
    await this.toolsRegistered;
    // Small delay to ensure everything is settled
    await new Promise(r => setTimeout(r, 100));
  }

  private async registerDefaultTools(): Promise<void> {
    try {
      const toolsModule = await import(
        "../core/environment/expend/os/tools/index.js"
      );
      const osTools = toolsModule.createOsTools();
      const todoTools = toolsModule.createTodoTools();

      const filteredTools = [...osTools, ...todoTools].filter(
        (t) =>
          t.name !== "invoke_llm" && t.name !== "system1_intuitive_reasoning"
      );

      for (const tool of filteredTools) {
        this.registerTool(tool);
      }
      console.log(`[ServerEnvironment] Registered ${filteredTools.length} tools`);
    } catch (err) {
      console.error("[ServerEnvironment] Failed to register tools:", err);
      console.log("[ServerEnvironment] Continuing without OS tools");
    }
  }

  protected getDefaultTimeout(toolName: string): number {
    return 30000;
  }

  protected getTimeoutOverride(action: Action): number | undefined {
    return undefined;
  }

  protected getMaxRetries(toolName: string): number {
    return 3;
  }

  protected getRetryDelay(toolName: string): number {
    return 1000;
  }

  protected isRetryableError(error: string): boolean {
    const retryablePatterns = [
      "ETIMEDOUT",
      "ECONNRESET",
      "ENOTFOUND",
      "rate limit",
      "429",
      "503",
    ];
    return retryablePatterns.some((pattern) =>
      error.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  protected getConcurrencyLimit(toolName: string): number {
    return 5;
  }

  protected getRecoveryStrategy(toolName: string): {
    type: "retry" | "fallback" | "skip" | "error";
    maxRetries?: number;
    fallbackTool?: string;
  } {
    return {
      type: "retry",
      maxRetries: 3,
    };
  }

  private async handleStreamEvent(
    event: StreamEvent,
    context: Context
  ): Promise<void> {
    const sessionId = context.session_id || this.sessionId;
    const messageId = context.message_id || `msg_${Date.now()}`;

    switch (event.type) {
      case "start":
        await Bus.publish(
          StreamStartEvent,
          {
            sessionId,
            messageId,
            model: (event.metadata?.model as string) || "unknown",
          },
          sessionId
        );
        break;

      case "text":
        await Bus.publish(
          StreamTextEvent,
          {
            sessionId,
            messageId,
            content: event.content || "",
            delta: event.delta || "",
          },
          sessionId
        );
        break;

      case "reasoning":
        await Bus.publish(
          StreamReasoningEvent,
          {
            sessionId,
            messageId,
            content: event.content || "",
          },
          sessionId
        );
        break;

      case "tool_call":
        await Bus.publish(
          StreamToolCallEvent,
          {
            sessionId,
            messageId,
            toolName: event.tool_name || "",
            toolArgs: event.tool_args || {},
            toolCallId: event.tool_call_id || "",
          },
          sessionId
        );
        break;

      case "tool_result":
        await Bus.publish(
          StreamToolResultEvent,
          {
            sessionId,
            messageId,
            toolName: event.tool_name || "",
            toolCallId: event.tool_call_id || "",
            result: event.tool_result,
            success: true,
          },
          sessionId
        );
        break;

      case "completed":
        await Bus.publish(
          StreamCompletedEvent,
          {
            sessionId,
            messageId,
            usage: event.metadata?.usage as any,
          },
          sessionId
        );
        break;

      case "error":
        await Bus.publish(
          StreamErrorEvent,
          {
            sessionId,
            messageId,
            error: event.error || "Unknown error",
            code: event.code,
          },
          sessionId
        );
        break;

      default:
        console.warn(
          "[ServerEnvironment] Unknown stream event type:",
          event.type
        );
    }
  }
}
