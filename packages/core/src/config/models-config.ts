/**
 * @fileoverview Model Configuration Loader - Load models from config files
 *
 * Loads model configurations from:
 * 1. Environment-specific models.jsonc (environments/{env}/models.jsonc)
 * 2. Provider configurations (provider.*.models)
 *
 * Priority: Environment models > Provider built-in models
 */

import { Config_get, Config_getSync } from "./config.js";
import { ConfigPaths } from "./paths.js";
import { loadEnvironmentConfig } from "./sources/environment.js";
import type { Config } from "./types.js";

export interface ModelEntry {
  id: string;           // Full model ID (e.g., "anthropic/claude-3-opus")
  provider: string;     // Provider ID
  modelId: string;      // Model ID (e.g., "claude-3-opus")
  displayName?: string; // Human-readable name
  capabilities?: string[];
}

export interface ProviderModels {
  providerID: string;
  providerName: string;
  models: ModelEntry[];
}

/**
 * Get active environment name from config
 * Returns null if no active environment is set
 */
export async function ModelsConfig_getActiveEnvironment(): Promise<string | null> {
  const config = await Config_get();
  return config.activeEnvironment || null;
}

/**
 * Get models from environment-specific models.jsonc
 * Loads from: ~/.config/tong_work/agent-core/environments/{env}/models.jsonc
 */
export async function ModelsConfig_getFromEnvironment(
  envName?: string
): Promise<ModelEntry[]> {
  const activeEnv = envName || (await ModelsConfig_getActiveEnvironment());
  
  if (!activeEnv) {
    console.log("[ModelsConfig] No active environment set");
    return [];
  }

  try {
    const envConfig = await loadEnvironmentConfig(activeEnv);
    
    if (!envConfig?.models) {
      console.log(`[ModelsConfig] No models config found in environment "${activeEnv}"`);
      return [];
    }

    const models: ModelEntry[] = [];
    
    // Convert Record<string, ModelConfig> to ModelEntry[]
    for (const [key, modelConfig] of Object.entries(envConfig.models)) {
      models.push({
        id: `${modelConfig.provider}/${modelConfig.modelId}`,
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
        displayName: modelConfig.displayName || modelConfig.modelId,
        capabilities: modelConfig.capabilities || [],
      });
    }

    console.log(`[ModelsConfig] Loaded ${models.length} models from environment "${activeEnv}"`);
    return models;
  } catch (error) {
    console.error(`[ModelsConfig] Failed to load models from environment "${activeEnv}":`, error);
    return [];
  }
}

/**
 * Get models from provider configurations
 * Combines built-in provider models with user-configured models
 */
export async function ModelsConfig_getFromProviders(): Promise<ProviderModels[]> {
  const config = await Config_get();
  const providers: ProviderModels[] = [];

  // Get models from provider configs
  if (config.provider) {
    for (const [providerId, providerConfig] of Object.entries(config.provider)) {
      if (providerConfig.models && providerConfig.models.length > 0) {
        providers.push({
          providerID: providerId,
          providerName: providerId, // Could be enhanced with display name
          models: providerConfig.models.map((modelId) => ({
            id: `${providerId}/${modelId}`,
            provider: providerId,
            modelId: modelId,
            displayName: modelId,
          })),
        });
      }
    }
  }

  return providers;
}

/**
 * Get all available models
 * Priority: Environment models > Provider configured models > Built-in models
 */
export async function ModelsConfig_getAll(): Promise<ProviderModels[]> {
  // 1. First try to get models from active environment
  const envModels = await ModelsConfig_getFromEnvironment();
  
  if (envModels.length > 0) {
    // Group by provider
    const byProvider = new Map<string, ModelEntry[]>();
    
    for (const model of envModels) {
      if (!byProvider.has(model.provider)) {
        byProvider.set(model.provider, []);
      }
      byProvider.get(model.provider)!.push(model);
    }

    // Convert to ProviderModels format
    return Array.from(byProvider.entries()).map(([providerId, models]) => ({
      providerID: providerId,
      providerName: models[0]?.displayName?.split('/')[0] || providerId,
      models,
    }));
  }

  // 2. Fall back to provider configurations
  return await ModelsConfig_getFromProviders();
}

/**
 * Get models synchronously (only if config is already loaded)
 * Returns empty array if config not loaded yet
 */
export function ModelsConfig_getAllSync(): ProviderModels[] {
  const config = Config_getSync();
  
  if (!config?.models || Object.keys(config.models).length === 0) {
    return [];
  }

  const byProvider = new Map<string, ModelEntry[]>();
  
  for (const [key, modelConfig] of Object.entries(config.models)) {
    const entry: ModelEntry = {
      id: `${modelConfig.provider}/${modelConfig.modelId}`,
      provider: modelConfig.provider,
      modelId: modelConfig.modelId,
      displayName: modelConfig.displayName || modelConfig.modelId,
      capabilities: modelConfig.capabilities || [],
    };
    
    if (!byProvider.has(modelConfig.provider)) {
      byProvider.set(modelConfig.provider, []);
    }
    byProvider.get(modelConfig.provider)!.push(entry);
  }

  return Array.from(byProvider.entries()).map(([providerId, models]) => ({
    providerID: providerId,
    providerName: models[0]?.displayName?.split('/')[0] || providerId,
    models,
  }));
}

/**
 * Get active environment configuration path
 * Returns the path to the active environment's models.jsonc
 */
export async function ModelsConfig_getActiveEnvironmentPath(): Promise<string | null> {
  const activeEnv = await ModelsConfig_getActiveEnvironment();
  if (!activeEnv) return null;
  
  return `${ConfigPaths.environments}/${activeEnv}/models.jsonc`;
}
