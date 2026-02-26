/**
 * @fileoverview Provider Manager with AI SDK Integration
 * 
 * Manages LLM provider instances using AI SDK.
 * Loads configuration from providers.jsonc and creates AI SDK provider instances.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { loadProvidersConfig, type ProviderConfig } from "../config/sources/providers.js";
import type { 
  ProviderMetadata, 
  ProviderInstance, 
  ModelMetadata, 
  ModelCapabilities,
  SDKType 
} from "./types.js";
import { createLogger } from "../utils/logger.js";

const providerLogger = createLogger("provider-manager", "server.log");

// Default capabilities for unknown models
const DEFAULT_CAPABILITIES: ModelCapabilities = {
  temperature: true,
  reasoning: false,
  toolcall: true,
  attachment: false,
  input: {
    text: true,
    image: false,
    audio: false,
    video: false,
    pdf: false,
  },
  output: {
    text: true,
    image: false,
    audio: false,
  },
};

/**
 * Provider Manager singleton
 * Manages AI SDK provider instances and metadata
 */
class ProviderManager {
  private providers: Map<string, ProviderInstance> = new Map();
  private initialized = false;

  /**
   * Initialize the provider manager
   * Load providers.jsonc and create AI SDK instances
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      providerLogger.debug("ProviderManager already initialized");
      return;
    }

    providerLogger.info("Initializing ProviderManager...");

    const config = await loadProvidersConfig();
    if (!config?.providers) {
      providerLogger.warn("No providers found in providers.jsonc");
      this.initialized = true;
      return;
    }

    for (const [providerId, providerConfig] of Object.entries(config.providers)) {
      try {
        // 1. Resolve environment variables in apiKey
        const resolvedApiKey = this.resolveEnvVar(providerConfig.apiKey);
        providerLogger.info(`[ProviderManager] Processing provider: ${providerId}`, {
          hasApiKey: !!providerConfig.apiKey,
          apiKeyResolved: !!resolvedApiKey,
          baseURL: providerConfig.baseURL,
          modelsCount: providerConfig.models?.length || 0
        });
        
        if (!resolvedApiKey) {
          providerLogger.warn(`[ProviderManager] Skipping provider ${providerId}: API key not found or empty`);
          continue;
        }

        // 2. Determine SDK type
        const sdkType = providerConfig.sdkType || this.inferSDKType(providerId, providerConfig.baseURL);

        // 3. Create AI SDK provider instance
        const sdkProvider = this.createSDKProvider(sdkType, {
          ...providerConfig,
          apiKey: resolvedApiKey,
        });

        if (!sdkProvider) {
          providerLogger.warn(`Failed to create SDK provider for ${providerId}`);
          continue;
        }

        // 4. Create metadata
        const metadata = this.createMetadata(providerId, providerConfig, resolvedApiKey, sdkType);

        // 5. Store provider instance
        this.providers.set(providerId, {
          metadata,
          sdk: sdkProvider,
        });

        providerLogger.info(`Provider ${providerId} initialized with ${metadata.models.length} models`);
      } catch (error) {
        providerLogger.error(`Failed to initialize provider ${providerId}:`, error);
      }
    }

    this.initialized = true;
    providerLogger.info(`ProviderManager initialized with ${this.providers.size} providers`);
  }

  /**
   * Get a provider instance by ID
   */
  getProvider(providerId: string): ProviderInstance | undefined {
    return this.providers.get(providerId);
  }

  /**
   * Get provider metadata
   */
  getMetadata(providerId: string): ProviderMetadata | undefined {
    return this.providers.get(providerId)?.metadata;
  }

  /**
   * List all available providers
   */
  listProviders(): ProviderMetadata[] {
    return Array.from(this.providers.values()).map(p => p.metadata);
  }

  /**
   * Check if a provider exists
   */
  hasProvider(providerId: string): boolean {
    return this.providers.has(providerId);
  }

  /**
   * Get all provider IDs
   */
  getProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Resolve environment variable placeholder
   * "${ZHIPUAI_API_KEY}" → process.env.ZHIPUAI_API_KEY
   */
  private resolveEnvVar(value: string | undefined): string | undefined {
    if (!value) return undefined;

    if (value.startsWith("${") && value.endsWith("}")) {
      const envVar = value.slice(2, -1);
      const resolved = process.env[envVar];
      if (!resolved) {
        providerLogger.warn(`Environment variable ${envVar} not found`);
      }
      return resolved;
    }

    return value;
  }

  /**
   * Infer SDK type from provider ID or base URL
   */
  private inferSDKType(providerId: string, baseURL: string): SDKType {
    const id = providerId.toLowerCase();
    const url = baseURL.toLowerCase();

    if (id === "openai" || url.includes("openai.com")) {
      return "openai";
    }
    if (id === "anthropic" || url.includes("anthropic.com")) {
      return "anthropic";
    }
    if (id === "google" || url.includes("googleapis.com") || url.includes("generativelanguage")) {
      return "google";
    }

    // Default to openai-compatible for unknown providers
    return "openai-compatible";
  }

  /**
   * Create AI SDK provider instance
   */
  private createSDKProvider(
    sdkType: SDKType,
    config: ProviderConfig & { apiKey: string }
  ): any {
    const { baseURL, apiKey, headers } = config;

    try {
      switch (sdkType) {
        case "openai":
          return createOpenAI({
            baseURL,
            apiKey,
            headers,
          });

        case "anthropic":
          return createAnthropic({
            baseURL,
            apiKey,
            headers,
          });

        case "google":
          return createGoogleGenerativeAI({
            baseURL,
            apiKey,
            headers,
          });

        case "openai-compatible":
        default:
          return createOpenAICompatible({
            name: config.name?.toLowerCase().replace(/\s+/g, "-") || "custom",
            baseURL,
            apiKey,
            headers,
          });
      }
    } catch (error) {
      providerLogger.error(`Failed to create ${sdkType} provider:`, error);
      return null;
    }
  }

  /**
   * Create provider metadata from config
   */
  private createMetadata(
    providerId: string,
    config: ProviderConfig,
    resolvedApiKey: string,
    sdkType: SDKType
  ): ProviderMetadata {
    const models = (config.models || []).map((modelId): ModelMetadata => {
      // Merge default capabilities with any custom capabilities
      const customCaps = config.capabilities || {};
      return {
        id: modelId,
        capabilities: {
          temperature: customCaps.temperature ?? DEFAULT_CAPABILITIES.temperature,
          reasoning: customCaps.reasoning ?? DEFAULT_CAPABILITIES.reasoning,
          toolcall: customCaps.toolcall ?? DEFAULT_CAPABILITIES.toolcall,
          attachment: customCaps.attachment ?? DEFAULT_CAPABILITIES.attachment,
          input: {
            text: customCaps.input?.text ?? DEFAULT_CAPABILITIES.input.text,
            image: customCaps.input?.image ?? DEFAULT_CAPABILITIES.input.image,
            audio: customCaps.input?.audio ?? DEFAULT_CAPABILITIES.input.audio,
            video: customCaps.input?.video ?? DEFAULT_CAPABILITIES.input.video,
            pdf: customCaps.input?.pdf ?? DEFAULT_CAPABILITIES.input.pdf,
          },
          output: {
            text: customCaps.output?.text ?? DEFAULT_CAPABILITIES.output.text,
            image: customCaps.output?.image ?? DEFAULT_CAPABILITIES.output.image,
            audio: customCaps.output?.audio ?? DEFAULT_CAPABILITIES.output.audio,
          },
        },
        limits: {
          contextWindow: 8192, // Default value
        },
      };
    });

    return {
      id: providerId,
      name: config.name,
      description: config.description,
      baseURL: config.baseURL,
      apiKey: resolvedApiKey,
      headers: config.headers,
      models,
      defaultModel: config.defaultModel || models[0]?.id || "",
      sdkType,
    };
  }

  /**
   * Reset all providers (for testing)
   */
  reset(): void {
    this.providers.clear();
    this.initialized = false;
    providerLogger.info("ProviderManager reset");
  }
}

// Export singleton instance
export const providerManager = new ProviderManager();

// Export class for testing
export { ProviderManager };
