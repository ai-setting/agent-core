/**
 * @fileoverview Provider Management
 * 
 * Manages provider configurations:
 * - Built-in defaults (openai, anthropic, google)
 * - providers.jsonc (primary source)
 */

import fs from "fs/promises";
import path from "path";
import { ConfigPaths } from "./paths.js";
import { Config_reload } from "./config.js";
import { loadProvidersConfig } from "./sources/providers.js";

const PROVIDERS_CONFIG_FILE = path.join(ConfigPaths.config, "providers.jsonc");

/**
 * Provider info as stored in config
 */
export interface ProviderInfo {
  id: string;
  name: string;
  description?: string;
  baseURL?: string;
  apiKey?: string;
  models?: string[];
  defaultModel?: string;
}

/**
 * Load providers configuration from providers.jsonc
 */
export async function Providers_load(): Promise<Record<string, ProviderInfo>> {
  const config = await loadProvidersConfig();
  if (!config?.providers) {
    return {};
  }
  
  const result: Record<string, ProviderInfo> = {};
  for (const [id, p] of Object.entries(config.providers)) {
    result[id] = {
      id,
      name: p.name,
      description: p.description,
      baseURL: p.baseURL,
      apiKey: p.apiKey,
      models: p.models,
      defaultModel: p.defaultModel,
    };
  }
  return result;
}

/**
 * Save providers configuration to providers.jsonc
 */
export async function Providers_save(providers: Record<string, ProviderInfo>): Promise<void> {
  try {
    await fs.mkdir(ConfigPaths.config, { recursive: true });
    
    const config = {
      providers,
      _updated: new Date().toISOString(),
    };
    
    const content = `// Provider configurations
// This file stores provider metadata (baseURL, models, apiKey, etc.)

${JSON.stringify(config, null, 2)}`;
    
    await fs.writeFile(PROVIDERS_CONFIG_FILE, content, "utf-8");
    
    Config_reload();
  } catch (error) {
    console.error("[Providers] Failed to save providers config:", error);
    throw error;
  }
}

/**
 * Get a single provider by ID
 */
export async function Providers_get(id: string): Promise<ProviderInfo | undefined> {
  const all = await Providers_getAll();
  return all.find(p => p.id === id);
}

/**
 * Add or update a provider
 */
export async function Providers_set(id: string, info: ProviderInfo): Promise<void> {
  const providers = await Providers_load();
  providers[id] = { ...info, id };
  await Providers_save(providers);
}

/**
 * Remove a provider
 */
export async function Providers_remove(id: string): Promise<void> {
  const providers = await Providers_load();
  delete providers[id];
  await Providers_save(providers);
}

/**
 * List all provider IDs
 */
export async function Providers_list(): Promise<string[]> {
  const providers = await Providers_getAll();
  return providers.map(p => p.id);
}

/**
 * Built-in providers with default models (minimal set)
 * Primary sources: providers.jsonc (recommended) > built-in
 */
const builtinProviders: ProviderInfo[] = [
  { 
    id: "openai", 
    name: "OpenAI", 
    description: "GPT models by OpenAI", 
    baseURL: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    defaultModel: "gpt-4o"
  },
  { 
    id: "anthropic", 
    name: "Anthropic", 
    description: "Claude models by Anthropic", 
    baseURL: "https://api.anthropic.com/v1",
    models: ["claude-sonnet-4-5", "claude-sonnet-4-20250514", "claude-haiku-3-5"],
    defaultModel: "claude-sonnet-4-5"
  },
  { 
    id: "google", 
    name: "Google", 
    description: "Gemini models by Google", 
    baseURL: "https://generativelanguage.googleapis.com/v1",
    models: ["gemini-2.0-flash-exp", "gemini-2.0-pro-exp", "gemini-1.5-pro"],
    defaultModel: "gemini-2.0-flash-exp"
  },
];

/**
 * Get full provider list including built-in and custom providers
 * Merges data from built-in and providers.jsonc
 * Priority: providers.jsonc > built-in
 */
export async function Providers_getAll(): Promise<ProviderInfo[]> {
  const providersConfig = await loadProvidersConfig();
  
  const merged: Record<string, ProviderInfo> = {};
  
  // 1. Add built-in providers first (lowest priority)
  for (const p of builtinProviders) {
    merged[p.id] = { ...p };
  }
  
  // 2. Add providers from providers.jsonc (higher priority)
  if (providersConfig?.providers) {
    for (const [id, p] of Object.entries(providersConfig.providers)) {
      merged[id] = {
        ...merged[id],
        id,
        name: p.name,
        description: p.description,
        baseURL: p.baseURL,
        apiKey: p.apiKey,
        models: p.models,
        defaultModel: p.defaultModel,
      };
    }
  }
  
  const result = Object.values(merged);
  
  // Add "Custom Provider" option at the end
  result.push({
    id: "custom",
    name: "Custom Provider",
    description: "Add a custom LLM provider",
  });
  
  return result;
}
