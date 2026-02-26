/**
 * @fileoverview LLM Provider System Type Definitions
 * 
 * Type definitions for the Provider system with AI SDK integration.
 * Based on opencode's provider architecture.
 */

/**
 * Interleaved reasoning configuration
 * For models that output reasoning/thinking content interleaved with regular content
 * (e.g., Kimi k2.5, DeepSeek R1, etc.)
 */
export interface InterleavedReasoning {
  /** Field name for reasoning content in provider options */
  field: "reasoning_content" | "reasoning_details";
}

/**
 * Model capability metadata
 * Describes what a model can do
 */
export interface ModelCapabilities {
  /** Whether the model supports temperature parameter */
  temperature: boolean;
  /** Whether the model supports reasoning/thinking */
  reasoning: boolean;
  /** Whether the model supports tool calling */
  toolcall: boolean;
  /** Whether the model supports file attachments */
  attachment: boolean;
  /** Input modalities supported */
  input: {
    text: boolean;
    image: boolean;
    audio: boolean;
    video: boolean;
    pdf: boolean;
  };
  /** Output modalities supported */
  output: {
    text: boolean;
    image: boolean;
    audio: boolean;
  };
  /** 
   * Interleaved reasoning configuration
   * When present, reasoning content will be extracted from messages and placed
   * in the specified field of providerOptions
   */
  interleaved?: InterleavedReasoning;
}

/**
 * Model limit metadata
 * Describes constraints of a model
 */
export interface ModelLimits {
  /** Context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens */
  maxOutputTokens?: number;
  /** Maximum input tokens (if different from contextWindow) */
  maxInputTokens?: number;
}

/**
 * Model cost metadata (optional)
 * Describes pricing per 1K tokens
 */
export interface ModelCost {
  /** Cost per 1K input tokens */
  input: number;
  /** Cost per 1K output tokens */
  output: number;
  /** Cost per 1K cached input tokens (if applicable) */
  cacheRead?: number;
  /** Cost per 1K cache write tokens (if applicable) */
  cacheWrite?: number;
}

/**
 * Model metadata
 * Complete description of a model
 */
export interface ModelMetadata {
  /** Model ID (e.g., "glm-4", "gpt-4o") */
  id: string;
  /** Display name */
  name?: string;
  /** Model family (e.g., "GPT-4", "Claude 3") */
  family?: string;
  /** Model capabilities */
  capabilities: ModelCapabilities;
  /** Model constraints */
  limits: ModelLimits;
  /** Model pricing (optional) */
  cost?: ModelCost;
  /** Provider-specific model options */
  options?: Record<string, unknown>;
}

/**
 * SDK type for provider
 * Determines which AI SDK factory to use
 */
export type SDKType = 'openai' | 'anthropic' | 'google' | 'openai-compatible';

/**
 * Provider metadata
 * Complete description of an LLM provider
 */
export interface ProviderMetadata {
  /** Provider ID (e.g., "zhipuai", "openai") */
  id: string;
  /** Display name */
  name: string;
  /** Description */
  description?: string;
  
  /** API base URL */
  baseURL: string;
  /** API key (already resolved from environment variable) */
  apiKey: string;
  /** Additional headers to send with requests */
  headers?: Record<string, string>;
  
  /** List of available models */
  models: ModelMetadata[];
  /** Default model ID */
  defaultModel: string;
  
  /** SDK type for this provider */
  sdkType: SDKType;
}

/**
 * Provider instance
 * Contains both metadata and the AI SDK provider instance
 */
export interface ProviderInstance {
  /** Provider metadata */
  metadata: ProviderMetadata;
  /** AI SDK provider instance */
  sdk: any;
}

/**
 * Raw provider config from providers.jsonc
 * Before environment variable resolution
 */
export interface RawProviderConfig {
  name: string;
  description?: string;
  baseURL: string;
  /** Can be "${ENV_VAR}" format or actual key */
  apiKey: string;
  models: string[];
  defaultModel: string;
  sdkType?: SDKType;
  capabilities?: Partial<ModelCapabilities>;
  headers?: Record<string, string>;
}

/**
 * Resolved provider config
 * After environment variable resolution
 */
export interface ResolvedProviderConfig extends RawProviderConfig {
  /** Resolved API key (actual value, not env var placeholder) */
  apiKey: string;
}

/**
 * Complete providers config structure
 */
export interface ProvidersConfig {
  defaultModel: string;
  providers: Record<string, RawProviderConfig>;
}
