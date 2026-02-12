/**
 * @fileoverview Provider Management - Provider configuration persistence
 * 
 * Manages provider configurations in config.jsonc, including:
 * - baseURL
 * - models list
 * - description
 * 
 * API keys are still stored in auth.json
 */

import fs from "fs/promises";
import path from "path";
import { ConfigPaths } from "./paths.js";
import { Config_get, Config_reload, Config_notifyChange } from "./config.js";
import type { Config } from "./types.js";

// Provider configuration file path
const PROVIDERS_CONFIG_FILE = path.join(ConfigPaths.config, "providers.jsonc");

/**
 * Provider info as stored in config
 */
export interface ProviderInfo {
  id: string;
  name: string;
  description?: string;
  baseURL?: string;
  models?: string[];
  defaultModel?: string;
}

/**
 * Load providers configuration from providers.jsonc
 */
export async function Providers_load(): Promise<Record<string, ProviderInfo>> {
  try {
    const content = await fs.readFile(PROVIDERS_CONFIG_FILE, "utf-8");
    // Remove comments (JSONC format)
    const jsonContent = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    if (!jsonContent.trim()) {
      return {};
    }
    const parsed = JSON.parse(jsonContent);
    return parsed.providers || {};
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
      // File doesn't exist, return empty object
      return {};
    }
    console.warn("[Providers] Failed to load providers config:", error);
    return {};
  }
}

/**
 * Save providers configuration to providers.jsonc
 */
export async function Providers_save(providers: Record<string, ProviderInfo>): Promise<void> {
  try {
    // Ensure config directory exists
    await fs.mkdir(ConfigPaths.config, { recursive: true });
    
    const config = {
      providers,
      _updated: new Date().toISOString(),
    };
    
    const content = `// Provider configurations
// This file stores provider metadata (baseURL, models, etc.)
// API keys are stored separately in auth.json

${JSON.stringify(config, null, 2)}`;
    
    await fs.writeFile(PROVIDERS_CONFIG_FILE, content, "utf-8");
    
    // Notify config change
    const currentConfig = await Config_get();
    Config_notifyChange(currentConfig);
  } catch (error) {
    console.error("[Providers] Failed to save providers config:", error);
    throw error;
  }
}

/**
 * Get a single provider by ID
 */
export async function Providers_get(id: string): Promise<ProviderInfo | undefined> {
  const providers = await Providers_load();
  return providers[id];
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
  const providers = await Providers_load();
  return Object.keys(providers);
}

/**
 * Merge providers from config.jsonc (legacy) into providers.jsonc
 * This is used for migration or when providers are defined in the main config
 */
export async function Providers_mergeFromConfig(): Promise<void> {
  const config = await Config_get();
  if (!config.provider) {
    return;
  }
  
  const existing = await Providers_load();
  let updated = false;
  
  for (const [id, providerConfig] of Object.entries(config.provider)) {
    if (!existing[id]) {
      existing[id] = {
        id,
        name: id,
        baseURL: providerConfig.baseURL,
        models: providerConfig.models,
        defaultModel: providerConfig.defaultModel,
      };
      updated = true;
    }
  }
  
  if (updated) {
    await Providers_save(existing);
  }
}

/**
 * Get full provider list including built-in and custom providers
 * Merges data from providers.jsonc and auth.json
 */
export async function Providers_getAll(): Promise<ProviderInfo[]> {
  const [customProviders, config] = await Promise.all([
    Providers_load(),
    Config_get(),
  ]);
  
  // Built-in providers
  const builtinProviders: ProviderInfo[] = [
    { id: "anthropic", name: "Anthropic", description: "Claude models by Anthropic", baseURL: "https://api.anthropic.com/v1" },
    { id: "openai", name: "OpenAI", description: "GPT models by OpenAI", baseURL: "https://api.openai.com/v1" },
    { id: "google", name: "Google", description: "Gemini models by Google", baseURL: "https://generativelanguage.googleapis.com/v1" },
    { id: "deepseek", name: "DeepSeek", description: "DeepSeek models", baseURL: "https://api.deepseek.com/v1" },
    { id: "zhipuai", name: "ZhipuAI", description: "GLM models by ZhipuAI", baseURL: "https://open.bigmodel.cn/api/paas/v4" },
    { id: "kimi", name: "Kimi", description: "Moonshot AI Kimi models", baseURL: "https://api.moonshot.cn/v1" },
  ];
  
  // Merge custom providers from providers.jsonc
  const allProviders: ProviderInfo[] = [];
  
  // Add custom providers first
  for (const [id, info] of Object.entries(customProviders)) {
    if (!builtinProviders.find(p => p.id === id)) {
      allProviders.push(info);
    }
  }
  
  // Add built-in providers (with config from providers.jsonc if available)
  for (const builtin of builtinProviders) {
    const custom = customProviders[builtin.id];
    if (custom) {
      // Merge custom config with builtin
      allProviders.push({
        ...builtin,
        ...custom,
        id: builtin.id, // Ensure ID is correct
      });
    } else {
      allProviders.push(builtin);
    }
  }
  
  // Add "Custom Provider" option at the end
  allProviders.push({
    id: "custom",
    name: "Custom Provider",
    description: "Add a custom LLM provider",
  });
  
  return allProviders;
}
