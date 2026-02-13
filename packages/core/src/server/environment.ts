/**
 * @fileoverview ServerEnvironment - Environment with EventBus integration
 *
 * Extends BaseEnvironment to publish stream events via EventBus.
 */

import {
  BaseEnvironment,
  BaseEnvironmentConfig,
  type SessionEvent,
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
import {
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionDeletedEvent,
} from "./eventbus/events/session.js";
import { Config_get, resolveConfig } from "../config/index.js";
import { ModelStore } from "../config/state/model-store.js";
import { Providers_getAll, type ProviderInfo } from "../config/providers.js";
import { Auth_getProvider } from "../config/auth.js";
import { ModelsConfig_getAll, type ModelEntry } from "../config/models-config.js";

export interface ServerEnvironmentConfig extends BaseEnvironmentConfig {
  sessionId?: string;
  /** Whether to load configuration from config files. Defaults to true. */
  loadConfig?: boolean;
  /** Current model selection (in-memory only, not persisted) */
  currentModel?: {
    providerID: string;
    modelID: string;
  };
}

export class ServerEnvironment extends BaseEnvironment {
  private sessionId: string;
  private toolsRegistered: Promise<void>;
  private configLoaded: Promise<void>;
  private modelStore: ModelStore;
  private currentModelSelection: { providerID: string; modelID: string } | null = null;

  constructor(config?: ServerEnvironmentConfig) {
    const envConfig: BaseEnvironmentConfig = {
      ...config,
      onStreamEvent: (event: StreamEvent, context: Context) => {
        this.handleStreamEvent(event, context);
      },
      onSessionEvent: (event: SessionEvent) => {
        this.handleSessionEvent(event);
      },
    };

    super(envConfig);
    this.sessionId = config?.sessionId || "default";
    this.modelStore = new ModelStore();

    // Initialize current model selection if provided
    if (config?.currentModel) {
      this.currentModelSelection = config.currentModel;
    }

    // Load config and initialize LLM if loadConfig is not explicitly false
    if (config?.loadConfig !== false) {
      this.configLoaded = this.loadConfigAndInitLLM();
    } else {
      this.configLoaded = Promise.resolve();
    }

    this.toolsRegistered = this.registerDefaultTools();
  }

  /**
   * Load configuration from config files and initialize LLM
   * Supports fallback chain: current > config > recent > provider default
   */
  private async loadConfigAndInitLLM(): Promise<void> {
    try {
      console.log("[ServerEnvironment] Loading configuration...");

      // 1. Load config file
      const rawConfig = await Config_get();
      const config = await resolveConfig(rawConfig);

      // 2. Load user model preferences
      await this.modelStore.load();
      const recent = await this.modelStore.getRecent();

      // 3. Get all providers
      const providers = await Providers_getAll();

      // 4. Parse config model if present
      const configModel = config.defaultModel
        ? this.parseModelString(config.defaultModel)
        : null;

      // 5. Select model with fallback chain
      const selectedModel = await this.selectModelWithFallback(
        this.currentModelSelection,
        configModel,
        recent,
        providers
      );

      if (selectedModel) {
        console.log(
          `[ServerEnvironment] Selected model: ${selectedModel.providerID}/${selectedModel.modelID}`
        );

        // 6. Get API key
        const authInfo = await Auth_getProvider(selectedModel.providerID);
        if (!authInfo?.key) {
          console.warn(
            `[ServerEnvironment] No API key found for provider: ${selectedModel.providerID}`
          );
          return;
        }

        // 7. Get baseURL
        const providerInfo = providers.find(
          (p) => p.id === selectedModel.providerID
        );
        const baseURL =
          providerInfo?.baseURL ||
          authInfo.baseURL ||
          config.baseURL ||
          "https://api.openai.com/v1";

        // 8. Initialize LLM
        const modelFullName = `${selectedModel.providerID}/${selectedModel.modelID}`;
        await this.configureLLMWithModel(modelFullName, baseURL, authInfo.key);

        // 9. Update current selection (in-memory only)
        this.currentModelSelection = selectedModel;

        console.log("[ServerEnvironment] LLM initialized successfully");
      } else {
        console.log(
          "[ServerEnvironment] No valid model configuration found, skipping LLM initialization"
        );
      }
    } catch (error) {
      console.error(
        "[ServerEnvironment] Failed to load configuration:",
        error
      );
      // Don't throw - allow environment to work without LLM config
    }
  }

  /**
   * Select model with fallback chain
   * Priority: recent > config > provider default
   * 
   * Note: Recent models (user's last selection) take highest priority,
   * followed by config defaults, then provider defaults.
   */
  private async selectModelWithFallback(
    currentSelection: { providerID: string; modelID: string } | null,
    configModel: { providerID: string; modelID: string } | null,
    recent: Array<{ providerID: string; modelID: string }>,
    providers: ProviderInfo[]
  ): Promise<{ providerID: string; modelID: string } | null> {
    // 1. Check ModelStore recent list (highest priority - user's last selection)
    for (const entry of recent) {
      if (await this.isModelValid(entry, providers)) {
        console.log(`[ServerEnvironment] Using recent model: ${entry.providerID}/${entry.modelID}`);
        return entry;
      }
    }

    // 2. Check config default model
    if (configModel && (await this.isModelValid(configModel, providers))) {
      console.log(`[ServerEnvironment] Using config default model: ${configModel.providerID}/${configModel.modelID}`);
      return configModel;
    }

    // 3. Use first available provider's default model
    for (const provider of providers) {
      if (provider.models && provider.models.length > 0) {
        // Use defaultModel or first model
        const defaultModel = provider.defaultModel || provider.models[0];
        console.log(`[ServerEnvironment] Using provider default model: ${provider.id}/${defaultModel}`);
        return {
          providerID: provider.id,
          modelID: defaultModel,
        };
      }
    }

    return null;
  }

  /**
   * Validate if model is valid
   * Checks: 1) Config models, 2) Provider models, 3) Provider defaultModel
   */
  private async isModelValid(
    model: { providerID: string; modelID: string },
    providers: ProviderInfo[]
  ): Promise<boolean> {
    // 1. Check config models first (from models.jsonc)
    const configModels = await ModelsConfig_getAll();
    for (const providerModels of configModels) {
      if (providerModels.providerID === model.providerID) {
        const found = providerModels.models.find(
          (m: ModelEntry) => m.modelId === model.modelID
        );
        if (found) return true;
      }
    }

    // 2. Check provider's model list
    const provider = providers.find((p) => p.id === model.providerID);
    if (provider) {
      if (provider.models && provider.models.includes(model.modelID)) {
        return true;
      }

      // 3. Check if it's the defaultModel
      if (provider.defaultModel === model.modelID) {
        return true;
      }
    }

    return false;
  }

  /**
   * Parse model string (e.g., "anthropic/claude-3-sonnet")
   */
  private parseModelString(modelString: string): { providerID: string; modelID: string } | null {
    const parts = modelString.split("/");
    if (parts.length === 2) {
      return { providerID: parts[0], modelID: parts[1] };
    }
    return null;
  }

  /**
   * Switch current model (called by models command)
   */
  async switchModel(providerID: string, modelID: string): Promise<boolean> {
    try {
      const providers = await Providers_getAll();

      // Validate model
      if (!(await this.isModelValid({ providerID, modelID }, providers))) {
        console.error(`[ServerEnvironment] Invalid model: ${providerID}/${modelID}`);
        return false;
      }

      // Get API key
      const authInfo = await Auth_getProvider(providerID);
      if (!authInfo?.key) {
        console.error(`[ServerEnvironment] No API key for provider: ${providerID}`);
        return false;
      }

      // Get baseURL
      const providerInfo = providers.find((p) => p.id === providerID);
      const baseURL =
        providerInfo?.baseURL || authInfo.baseURL || "https://api.openai.com/v1";

      // Re-initialize LLM
      const modelFullName = `${providerID}/${modelID}`;
      await this.configureLLMWithModel(modelFullName, baseURL, authInfo.key);

      // Update current selection
      this.currentModelSelection = { providerID, modelID };

      // Add to recent
      await this.modelStore.addRecent(providerID, modelID);

      console.log(`[ServerEnvironment] Switched to model: ${providerID}/${modelID}`);
      return true;
    } catch (error) {
      console.error("[ServerEnvironment] Failed to switch model:", error);
      return false;
    }
  }

  /**
   * Get current selected model
   */
  getCurrentModel(): { providerID: string; modelID: string } | null {
    return this.currentModelSelection;
  }

  async waitForReady(): Promise<void> {
    // Wait for configuration loading
    await this.configLoaded;
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

      // All tools are external - LLM capabilities are native to Environment
      const allTools = [...osTools, ...todoTools];

      for (const tool of allTools) {
        this.registerTool(tool);
      }
      console.log(`[ServerEnvironment] Registered ${allTools.length} tools`);
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
    console.log("[ServerEnvironment] handleStreamEvent called", { type: event.type, hasCallback: !!this.onStreamEvent });
    const sessionId = context.session_id || this.sessionId;
    const messageId = context.message_id || `msg_${Date.now()}`;

    switch (event.type) {
      case "start":
        console.log("[ServerEnvironment] Publishing stream.start event", { sessionId, messageId });
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
        console.log("[ServerEnvironment] Publishing stream.text event", { sessionId, messageId, contentLength: event.content?.length });
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
        console.log("[ServerEnvironment] Publishing stream.reasoning event", { sessionId, messageId, contentLength: event.content?.length });
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

  private async handleSessionEvent(event: SessionEvent): Promise<void> {
    const sessionId = event.sessionId || this.sessionId;
    switch (event.type) {
      case "session.created":
        await Bus.publish(
          SessionCreatedEvent,
          {
            sessionId: event.sessionId,
            title: event.title,
            directory: event.directory,
          },
          sessionId
        );
        break;
      case "session.updated":
        await Bus.publish(
          SessionUpdatedEvent,
          {
            sessionId: event.sessionId,
            updates: event.updates,
          },
          sessionId
        );
        break;
      case "session.deleted":
        await Bus.publish(
          SessionDeletedEvent,
          { sessionId: event.sessionId },
          sessionId
        );
        break;
    }
  }
}
