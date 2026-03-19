/**
 * @fileoverview Model Limits Manager - retrieves model context window and compaction threshold.
 */

import { loadProvidersConfig, type ModelLimits } from "../../config/sources/providers.js";

const DEFAULT_CONTEXT_WINDOW = 200000; // 200K tokens
const DEFAULT_COMPACTION_THRESHOLD = 0.8; // 80%

// Pre-load all model limits at module initialization
let preloadedLimits: Map<string, ModelLimits> = new Map();

async function preloadModelLimits() {
  try {
    const config = await loadProvidersConfig();
    if (config?.providers) {
      for (const provider of Object.values(config.providers)) {
        if (provider.limits) {
          for (const [modelId, limits] of Object.entries(provider.limits)) {
            preloadedLimits.set(modelId, limits);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[ModelLimitsManager] Failed to preload limits:", err);
  }
}

// Preload on module load
preloadModelLimits();

export class ModelLimitsManager {
  private limitsCache: Map<string, ModelLimits> = new Map();

  /**
   * Get limits for a specific model.
   * Uses cache for performance.
   */
  async getLimits(modelId: string): Promise<ModelLimits> {
    // 1. Check in-memory preloaded limits first
    if (preloadedLimits.has(modelId)) {
      return preloadedLimits.get(modelId)!;
    }

    // 2. Check cache
    if (this.limitsCache.has(modelId)) {
      return this.limitsCache.get(modelId)!;
    }

    // 3. Return defaults
    return {
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      compactionThreshold: DEFAULT_COMPACTION_THRESHOLD,
    };
  }

  /**
   * Get compaction threshold for a model.
   */
  getCompactionThreshold(modelId: string, limits: ModelLimits): number {
    return limits?.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
  }

  /**
   * Get context window for a model.
   */
  getContextWindow(modelId: string, limits: ModelLimits): number {
    return limits?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  }

  /**
   * Clear cache (useful for testing or config reload)
   */
  clearCache(): void {
    this.limitsCache.clear();
  }
}

export const modelLimitsManager = new ModelLimitsManager();
