/**
 * @fileoverview Provider Factory - Creates SDK instances for different providers.
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
import { getProviderConfig, listProviders } from "./registry.js";

export interface ProviderOptions {
  providerID: string;
  modelID: string;
  apiKey?: string;
  baseURL?: string;
}

export interface SDKInstance {
  providerID: string;
  modelID: string;
  languageModel: unknown;
  npmPackage: string;
}

const providerFactories: Record<string, (options: Record<string, unknown>) => unknown> = {
  "@ai-sdk/openai": createOpenAI as unknown as (options: Record<string, unknown>) => unknown,
  "@ai-sdk/anthropic": createAnthropic as unknown as (options: Record<string, unknown>) => unknown,
  "@ai-sdk/google": createGoogleGenerativeAI as unknown as (options: Record<string, unknown>) => unknown,
  "@ai-sdk/openai-compatible": createOpenAICompatible as unknown as (options: Record<string, unknown>) => unknown,
  "@ai-sdk/mistral": createMistral as unknown as (options: Record<string, unknown>) => unknown,
  "@ai-sdk/groq": createGroq as unknown as (options: Record<string, unknown>) => unknown,
  "@ai-sdk/deepinfra": createDeepInfra as unknown as (options: Record<string, unknown>) => unknown,
  "@ai-sdk/cohere": createCohere as unknown as (options: Record<string, unknown>) => unknown,
  "@ai-sdk/xai": createXai as unknown as (options: Record<string, unknown>) => unknown,
  "@ai-sdk/cerebras": createCerebras as unknown as (options: Record<string, unknown>) => unknown,
  "@ai-sdk/togetherai": createTogetherAI as unknown as (options: Record<string, unknown>) => unknown,
  "@ai-sdk/perplexity": createPerplexity as unknown as (options: Record<string, unknown>) => unknown,
};

export function createProvider(options: ProviderOptions): SDKInstance {
  const config = getProviderConfig(options.providerID);
  if (!config) {
    throw new Error(`Unknown provider: ${options.providerID}`);
  }

  const npmPackage = config.npmPackage;
  const factory = providerFactories[npmPackage];
  if (!factory) {
    throw new Error(`No factory for provider: ${npmPackage}`);
  }

  const providerOptions: Record<string, unknown> = {
    name: options.providerID,
    apiKey: options.apiKey || process.env[`${options.providerID.toUpperCase()}_API_KEY`],
    ...(options.baseURL && { baseURL: options.baseURL }),
    ...(config.defaultBaseURL && !options.baseURL && { baseURL: config.defaultBaseURL }),
  };

  const sdk = factory(providerOptions);

  const languageModel = (sdk as { languageModel?: (modelID: string) => unknown }).languageModel
    ? (sdk as { languageModel: (modelID: string) => unknown }).languageModel(options.modelID)
    : (sdk as { chat?: (modelID: string) => unknown }).chat?.(options.modelID);

  return {
    providerID: options.providerID,
    modelID: options.modelID,
    languageModel,
    npmPackage,
  };
}

export function listAvailableProviders(): Array<{ id: string; name: string; defaultModel: string }> {
  return listProviders().map((p) => ({
    id: p.id,
    name: p.name,
    defaultModel: p.defaultModel || "",
  }));
}

export function getEnvVarsForProvider(providerID: string): string[] {
  return getProviderConfig(providerID)?.envVars || [];
}
