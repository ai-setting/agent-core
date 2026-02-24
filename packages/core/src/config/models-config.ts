/**
 * @fileoverview Model Configuration Loader
 * 
 * Loads model configurations from providers.jsonc
 */

import { Config_get, Config_getSync } from "./config.js";

export interface ModelEntry {
  id: string;
  provider: string;
  modelId: string;
  displayName?: string;
  capabilities?: string[];
}

export interface ProviderModels {
  providerID: string;
  providerName: string;
  models: ModelEntry[];
}

/**
 * Get models from provider configurations
 * Models are loaded from providers.jsonc
 */
export async function ModelsConfig_getAll(): Promise<ProviderModels[]> {
  const config = await Config_get();
  const providers: ProviderModels[] = [];

  if (config.providers) {
    for (const [providerId, providerConfig] of Object.entries(config.providers)) {
      if (providerConfig.models && providerConfig.models.length > 0) {
        providers.push({
          providerID: providerId,
          providerName: providerConfig.name || providerId,
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
 * Get models synchronously (only if config is already loaded)
 */
export function ModelsConfig_getAllSync(): ProviderModels[] {
  const config = Config_getSync();
  
  if (!config?.providers) {
    return [];
  }

  const providers: ProviderModels[] = [];
  
  for (const [providerId, providerConfig] of Object.entries(config.providers)) {
    if (providerConfig.models && providerConfig.models.length > 0) {
      providers.push({
        providerID: providerId,
        providerName: providerConfig.name || providerId,
        models: providerConfig.models.map((modelId) => ({
          id: `${providerId}/${modelId}`,
          provider: providerId,
          modelId: modelId,
          displayName: modelId,
        })),
      });
    }
  }

  return providers;
}
