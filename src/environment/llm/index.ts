/**
 * @fileoverview LLM adapter interface and common types.
 * Defines the contract for LLM provider implementations.
 */

import { LLMStreamEvent } from "../../types/index.js";

/**
 * LLM provider type identifiers.
 */
export type LLMProviderType = "openai" | "anthropic" | "google" | "ollama" | "custom";

/**
 * Parsed model identifier with provider and model ID.
 */
export interface ParsedModel {
  /** Provider identifier (e.g., "openai", "kimi", "deepseek"). */
  provider: string;

  /** Model identifier (e.g., "gpt-4o", "kimi-k2.5"). */
  model: string;

  /** Full model string (provider/model). */
  fullName: string;
}

/**
 * Parses a model string in provider/model format.
 *
 * @param model - Model string (e.g., "openai/gpt-4o", "kimi/kimi-k2.5")
 * @returns ParsedModel object
 *
 * @example
 * ```typescript
 * parseModel("kimi/kimi-k2.5")
 * // Returns: { provider: "kimi", model: "kimi-k2.5", fullName: "kimi/kimi-k2.5" }
 *
 * parseModel("gpt-4o")
 * // Returns: { provider: "openai", model: "gpt-4o", fullName: "openai/gpt-4o" }
 * ```
 */
export function parseModel(model: string): ParsedModel {
  const parts = model.split("/");
  if (parts.length >= 2) {
    return {
      provider: parts[0],
      model: parts.slice(1).join("/"),
      fullName: model,
    };
  }
  return {
    provider: "openai",
    model: model,
    fullName: `openai/${model}`,
  };
}

/**
 * Provider configuration with environment variable support.
 */
export interface ProviderConfig {
  /** Provider ID (e.g., "openai", "kimi"). */
  id: string;

  /** Human-readable name. */
  name: string;

  /** Environment variables to check for API key. */
  envVars: string[];

  /** Default base URL. */
  baseURL?: string;

  /** Default model if not specified. */
  defaultModel?: string;

  /** Provider-specific options. */
  options?: Record<string, unknown>;
}

/**
 * Common LLM configuration options.
 */
export interface LLMConfig {
  /** Model identifier to use (supports provider/model format). */
  model: string;

  /** Temperature for sampling (0-2). */
  temperature?: number;

  /** Maximum tokens to generate. */
  maxTokens?: number;

  /** Top-p sampling parameter (0-1). */
  topP?: number;

  /** Top-k sampling parameter. */
  topK?: number;

  /** Frequency penalty (-2 to 2). */
  frequencyPenalty?: number;

  /** Presence penalty (-2 to 2). */
  presencePenalty?: number;

  /** Stop sequences. */
  stop?: string[];

  /** Response format (e.g., for JSON mode). */
  responseFormat?: { type: "json_object" | "text" };
}

/**
 * Message format for LLM API.
 */
export interface LLMMessage {
  /** Role of the message sender. */
  role: "system" | "user" | "assistant" | "tool";

  /** Content of the message. */
  content: string;

  /** Name of the tool result (for tool messages). */
  name?: string;

  /** Tool calls from the assistant. */
  toolCalls?: LLMToolCall[];
}

/**
 * Tool call from LLM response.
 */
export interface LLMToolCall {
  /** Unique identifier for the tool call. */
  id: string;

  /** Function being called. */
  function: {
    /** Name of the function. */
    name: string;

    /** Arguments to pass to the function. */
    arguments: string;
  };
}

/**
 * LLM API response usage statistics.
 */
export interface LLMUsage {
  /** Number of input tokens. */
  inputTokens: number;

  /** Number of output tokens. */
  outputTokens: number;

  /** Total tokens used. */
  totalTokens?: number;
}

/**
 * Content type for streaming responses.
 */
export type StreamingContentType = "text" | "reasoning" | "tool-call";

/**
 * Streaming content chunk.
 */
export interface StreamingChunk {
  /** Type of content. */
  type: StreamingContentType;

  /** The content text. */
  text: string;

  /** Tool call information if applicable. */
  toolCall?: {
    name: string;
    arguments: Record<string, unknown>;
    id: string;
  };
}

/**
 * Callback interface for streaming responses.
 */
export interface LLMCallbacks {
  /** Called when the stream starts. */
  onStart?: () => void;

  /** Called for each content chunk (text or reasoning). */
  onContent?: (chunk: string, type: StreamingContentType) => void;

  /** Called when a tool call is received. */
  onToolCall?: (toolName: string, args: Record<string, unknown>, toolCallId: string) => void;

  /** Called when usage is available. */
  onUsage?: (usage: LLMUsage) => void;

  /** Called when stream completes. */
  onComplete?: (usage?: LLMUsage) => void;

  /** Called when an error occurs. */
  onError?: (error: Error) => void;
}

/**
 * Legacy callback interface for streaming responses.
 * @deprecated Use LLMCallbacks instead.
 */
export interface LLMCallbacksLegacy {
  onStart?: () => void;
  onContent?: (chunk: string, isReasoning: boolean) => void;
  onToolCall?: (toolName: string, args: Record<string, unknown>, toolCallId: string) => void;
  onUsage?: (usage: LLMUsage) => void;
  onComplete?: (usage?: LLMUsage) => void;
  onError?: (error: Error) => void;
}

/**
 * Result of a non-streaming LLM call.
 */
export interface LLMResult {
  /** The generated content. */
  content: string;

  /** Tool calls if any. */
  toolCalls?: LLMToolCall[];

  /** Usage statistics. */
  usage?: LLMUsage;

  /** Whether the call was successful. */
  success: true;
}

/**
 * Error result of an LLM call.
 */
export interface LLMError {
  /** Error message. */
  message: string;

  /** Error code if available. */
  code?: string;

  /** Whether this is a retryable error. */
  retryable?: boolean;
}

/**
 * Union type for LLM call results.
 */
export type LLMResponse = LLMResult | LLMError;

/**
 * Base interface for LLM adapters.
 *
 * Implement this interface to add support for new LLM providers.
 *
 * @example
 * ```typescript
 * class OpenAIAdapter implements LLMAdapter {
 *   readonly name: LLMProviderType = "openai";
 *   readonly displayName = "OpenAI";
 *
 *   isConfigured(): boolean { /* ... *\/ }
 *   complete(params: LLMCompleteParams): Promise<LLMResponse> { /* ... *\/ }
 *   stream(params: LLMStreamParams, callbacks: LLMCallbacks): Promise<void> { /* ... *\/ }
 * }
 * ```
 */
export interface LLMAdapter {
  /** Unique identifier for this adapter. */
  readonly name: LLMProviderType;

  /** Human-readable name of the provider. */
  readonly displayName: string;

  /**
   * Checks if the adapter is properly configured.
   *
   * @returns True if configuration is valid
   */
  isConfigured(): boolean;

  /**
   * Gets the default model for this provider.
   *
   * @returns Default model identifier
   */
  getDefaultModel(): string;

  /**
   * Lists available models for this provider.
   *
   * @returns Promise resolving to model list
   */
  listModels(): Promise<string[]>;

  /**
   * Makes a non-streaming LLM call.
   *
   * @param params - Completion parameters
   * @returns Promise resolving to the response
   */
  complete(params: LLMCompleteParams): Promise<LLMResponse>;

  /**
   * Makes a streaming LLM call.
   *
   * @param params - Stream parameters
   * @param callbacks - Callbacks for stream events
   * @returns Promise resolving when stream ends
   */
  stream(params: LLMStreamParams, callbacks: LLMCallbacks): Promise<void>;
}

/**
 * Parameters for non-streaming completion.
 */
export interface LLMCompleteParams {
  /** Messages to send to the LLM. */
  messages: LLMMessage[];

  /** Model configuration. */
  config?: LLMConfig;

  /** Abort signal for cancellation. */
  abort?: AbortSignal;

  /** Request metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for streaming completion.
 */
export interface LLMStreamParams {
  /** Messages to send to the LLM. */
  messages: LLMMessage[];

  /** Model configuration. */
  config?: LLMConfig;

  /** Abort signal for cancellation. */
  abort?: AbortSignal;

  /** Request metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Factory function for creating adapters.
 */
export type LLMAdapterFactory = (config: Record<string, unknown>) => LLMAdapter;

/**
 * Built-in provider configurations.
 */
export const BUILTIN_PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    envVars: ["OPENAI_API_KEY", "OPENAI_API_KEY_1"],
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
  },
  azure: {
    id: "azure",
    name: "Azure OpenAI",
    envVars: ["AZURE_OPENAI_API_KEY"],
    defaultModel: "gpt-4o",
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    envVars: ["ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_1"],
    defaultModel: "claude-sonnet-4-20250514",
  },
  google: {
    id: "google",
    name: "Google Gemini",
    envVars: ["GOOGLE_API_KEY"],
    defaultModel: "gemini-2.0-flash",
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    envVars: ["DEEPSEEK_API_KEY"],
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
  },
  kimi: {
    id: "kimi",
    name: "Kimi (Moonshot)",
    envVars: ["KIMI_API_KEY"],
    baseURL: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.5",
  },
  moonshot: {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    envVars: ["MOONSHOT_API_KEY"],
    baseURL: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.5",
  },
  ollama: {
    id: "ollama",
    name: "Ollama",
    envVars: [],
    baseURL: "http://localhost:11434/v1",
    defaultModel: "llama3",
  },
  groq: {
    id: "groq",
    name: "Groq",
    envVars: ["GROQ_API_KEY"],
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    envVars: ["PERPLEXITY_API_KEY"],
    baseURL: "https://api.perplexity.ai",
    defaultModel: "sonar-pro",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    envVars: ["OPENROUTER_API_KEY"],
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o",
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    envVars: ["CEREBRAS_API_KEY"],
    baseURL: "https://api.cerebras.ai/openai/v1",
    defaultModel: "llama-3.3-70b",
  },
};

/**
 * Gets API key from environment variables for a provider.
 * Supports LLM_API_KEY as a universal key, or provider-specific keys.
 *
 * @param provider - Provider ID
 * @returns API key or undefined if not found
 */
export function getApiKeyFromEnv(provider: string): string | undefined {
  if (process.env.LLM_API_KEY) {
    return process.env.LLM_API_KEY;
  }

  const config = BUILTIN_PROVIDERS[provider];
  if (!config) {
    return process.env[`${provider.toUpperCase()}_API_KEY`];
  }
  for (const envVar of config.envVars) {
    const value = process.env[envVar];
    if (value) return value;
  }
  return undefined;
}

/**
 * Gets base URL from environment variables for a provider.
 * Supports LLM_BASE_URL as a universal base URL, or falls back to provider defaults.
 *
 * @param provider - Provider ID
 * @returns Base URL or undefined to use provider default
 */
export function getBaseURLFromEnv(provider: string): string | undefined {
  if (process.env.LLM_BASE_URL) {
    return process.env.LLM_BASE_URL;
  }

  const config = BUILTIN_PROVIDERS[provider];
  return config?.baseURL;
}

/**
 * Creates an LLM adapter from provider/model string.
 *
 * @param model - Model string (e.g., "openai/gpt-4o", "kimi/kimi-k2.5")
 * @param options - Additional options (apiKey/baseURL override)
 * @returns LLMAdapter instance or undefined if not configured
 *
 * @example
 * ```typescript
 * const adapter = createAdapterFromModel("kimi/kimi-k2.5");
 * if (adapter) {
 *   // Use adapter
 * }
 * ```
 */
export async function createAdapterFromModel(
  model: string,
  options?: {
    baseURL?: string;
    apiKey?: string;
  },
): Promise<LLMAdapter | undefined> {
  const parsed = parseModel(model);
  const provider = parsed.provider;

  if (provider === "openai" || BUILTIN_PROVIDERS[provider]) {
    const config = BUILTIN_PROVIDERS[provider] || {
      id: provider,
      name: provider,
      envVars: [`${provider.toUpperCase()}_API_KEY`],
      baseURL: getBaseURLFromEnv(provider),
      defaultModel: parsed.model,
    };

    const apiKey = options?.apiKey ?? getApiKeyFromEnv(provider);
    if (!apiKey) {
      return undefined;
    }

    const adapterModule = await import("./adapters/openai.js");
    const OpenAIAdapter = adapterModule.OpenAIAdapter;

    if (!OpenAIAdapter) {
      return undefined;
    }

    const baseURL = options?.baseURL ?? getBaseURLFromEnv(provider) ?? config.baseURL;

    return new (OpenAIAdapter as new (config: any) => LLMAdapter)({
      apiKey,
      baseURL,
      defaultModel: parsed.model,
    });
  }

  return undefined;
}

export { LLMTransform } from "./transform.js";
export type { ModelInfo, TransformedConfig } from "./transform.js";
