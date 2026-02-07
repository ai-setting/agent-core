/**
 * @fileoverview Provider Registry - Built-in provider configurations.
 */

import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createMistral } from "@ai-sdk/mistral";
import { createGroq } from "@ai-sdk/groq";
import { createDeepInfra } from "@ai-sdk/deepinfra";
import { createCohere } from "@ai-sdk/cohere";
import { createXai } from "@ai-sdk/xai";
import { createCerebras } from "@ai-sdk/cerebras";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createPerplexity } from "@ai-sdk/perplexity";
import type { Provider as SDK } from "ai";
import type { ProviderInfo, ProviderModel, ProviderFactory } from "./models.js";

export interface ProviderConfig {
  id: string;
  name: string;
  npmPackage: string;
  factory: ProviderFactory;
  defaultBaseURL?: string;
  defaultModel?: string;
  envVars: string[];
}

const BUNDLED_PROVIDERS: Record<string, ProviderConfig> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    npmPackage: "@ai-sdk/openai",
    factory: createOpenAI as unknown as ProviderFactory,
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o",
    envVars: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    npmPackage: "@ai-sdk/anthropic",
    factory: createAnthropic as unknown as ProviderFactory,
    defaultBaseURL: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-20250514",
    envVars: ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"],
  },
  google: {
    id: "google",
    name: "Google",
    npmPackage: "@ai-sdk/google",
    factory: createGoogleGenerativeAI as unknown as ProviderFactory,
    defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-2.5-flash",
    envVars: ["GOOGLE_API_KEY", "GOOGLE_BASE_URL"],
  },
  "openai-compatible": {
    id: "openai-compatible",
    name: "OpenAI Compatible",
    npmPackage: "@ai-sdk/openai-compatible",
    factory: createOpenAICompatible as unknown as ProviderFactory,
    envVars: ["LLM_API_KEY", "LLM_BASE_URL"],
  },
  mistral: {
    id: "mistral",
    name: "Mistral AI",
    npmPackage: "@ai-sdk/mistral",
    factory: createMistral as unknown as ProviderFactory,
    defaultBaseURL: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    envVars: ["MISTRAL_API_KEY", "MISTRAL_BASE_URL"],
  },
  groq: {
    id: "groq",
    name: "Groq",
    npmPackage: "@ai-sdk/groq",
    factory: createGroq as unknown as ProviderFactory,
    defaultBaseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    envVars: ["GROQ_API_KEY", "GROQ_BASE_URL"],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    npmPackage: "@ai-sdk/openai-compatible",
    factory: createOpenAICompatible as unknown as ProviderFactory,
    defaultBaseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    envVars: ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL"],
  },
  kimi: {
    id: "kimi",
    name: "Kimi (Moonshot)",
    npmPackage: "@ai-sdk/openai-compatible",
    factory: createOpenAICompatible as unknown as ProviderFactory,
    defaultBaseURL: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.5",
    envVars: ["KIMI_API_KEY", "MOONSHOT_API_KEY", "KIMI_BASE_URL", "MOONSHOT_BASE_URL"],
  },
  moonshot: {
    id: "moonshot",
    name: "Moonshot",
    npmPackage: "@ai-sdk/openai-compatible",
    factory: createOpenAICompatible as unknown as ProviderFactory,
    defaultBaseURL: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.5",
    envVars: ["MOONSHOT_API_KEY", "MOONSHOT_BASE_URL"],
  },
  xai: {
    id: "xai",
    name: "xAI",
    npmPackage: "@ai-sdk/xai",
    factory: createXai as unknown as ProviderFactory,
    defaultBaseURL: "https://api.x.ai/v1",
    defaultModel: "grok-3",
    envVars: ["XAI_API_KEY", "XAI_BASE_URL"],
  },
  cerebras: {
    id: "cerebras",
    name: "Cerebras",
    npmPackage: "@ai-sdk/cerebras",
    factory: createCerebras as unknown as ProviderFactory,
    defaultBaseURL: "https://api.cerebras.ai/v1",
    defaultModel: "llama-3.3-70b",
    envVars: ["CEREBRAS_API_KEY", "CEREBRAS_BASE_URL"],
  },
  deepinfra: {
    id: "deepinfra",
    name: "DeepInfra",
    npmPackage: "@ai-sdk/deepinfra",
    factory: createDeepInfra as unknown as ProviderFactory,
    defaultBaseURL: "https://api.deepinfra.com/v1/openai",
    defaultModel: "deepseek-chat",
    envVars: ["DEEPINFRA_API_KEY", "DEEPINFRA_BASE_URL"],
  },
  togetherai: {
    id: "togetherai",
    name: "Together AI",
    npmPackage: "@ai-sdk/togetherai",
    factory: createTogetherAI as unknown as ProviderFactory,
    defaultBaseURL: "https://api.together.ai/v1",
    defaultModel: "deepseek-chat",
    envVars: ["TOGETHERAI_API_KEY", "TOGETHERAI_BASE_URL"],
  },
  perplexity: {
    id: "perplexity",
    name: "Perplexity",
    npmPackage: "@ai-sdk/perplexity",
    factory: createPerplexity as unknown as ProviderFactory,
    defaultBaseURL: "https://api.perplexity.ai",
    defaultModel: "sonar-pro",
    envVars: ["PERPLEXITY_API_KEY", "PERPLEXITY_BASE_URL"],
  },
  cohere: {
    id: "cohere",
    name: "Cohere",
    npmPackage: "@ai-sdk/cohere",
    factory: createCohere as unknown as ProviderFactory,
    defaultBaseURL: "https://api.cohere.ai/v1",
    defaultModel: "command-a",
    envVars: ["COHERE_API_KEY", "COHERE_BASE_URL"],
  },
};

export function getProviderConfig(providerID: string): ProviderConfig | undefined {
  return BUNDLED_PROVIDERS[providerID];
}

export function listProviders(): ProviderConfig[] {
  return Object.values(BUNDLED_PROVIDERS);
}

export function getEnvForProvider(providerID: string): string[] {
  const config = getProviderConfig(providerID);
  return config?.envVars || [];
}
