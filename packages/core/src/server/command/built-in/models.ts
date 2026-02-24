/**
 * @fileoverview Models Command - Model selection and management
 *
 * Manages model selection with persistent storage of recent/favorites
 * Integrates with ModelStore and Providers system
 */

import type { Command, CommandContext, CommandResult } from "../types.js";
import { serverLogger } from "../../logger.js";
import { ModelStore } from "../../../config/state/model-store.js";
import { 
  ModelsConfig_getAll, 
  type ModelEntry,
  type ProviderModels as ConfigProviderModels,
} from "../../../config/models-config.js";

interface ModelsAction {
  type: "list" | "select" | "toggle_favorite" | "set_variant";
  providerID?: string;
  modelID?: string;
  variant?: string;
}

interface ModelInfo {
  providerID: string;
  providerName: string;
  modelID: string;
  modelName: string;
  isFavorite: boolean;
  variant?: string;
}

interface ProviderModels {
  providerID: string;
  providerName: string;
  models: ModelInfo[];
}

/**
 * Models Command - Select and manage LLM models
 */
export const modelsCommand: Command = {
  name: "models",
  displayName: "Models",
  description: "Select and manage LLM models",
  hasArgs: false,

  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    const modelStore = new ModelStore();

    // Parse action
    let action: ModelsAction;
    try {
      action = args ? JSON.parse(args) : { type: "list" };
    } catch {
      return {
        success: false,
        message: "Invalid arguments",
        data: { error: "Invalid JSON" },
      };
    }

    switch (action.type) {
      case "list": {
        return await handleListAction(modelStore);
      }

      case "select": {
        return await handleSelectAction(context, modelStore, action);
      }

      case "toggle_favorite": {
        return await handleToggleFavoriteAction(modelStore, action);
      }

      case "set_variant": {
        return await handleSetVariantAction(modelStore, action);
      }

      default:
        return {
          success: false,
          message: `Unknown action: ${(action as ModelsAction).type}`,
        };
    }
  },
};

/**
 * Handle list action - return all providers and models from config
 */
async function handleListAction(modelStore: ModelStore): Promise<CommandResult> {
  // Load models from config (environment models.jsonc or provider configs)
  const providerModels = await ModelsConfig_getAll();
  const recent = await modelStore.getRecent();
  const favorites = await modelStore.getFavorite();

  serverLogger.info("[ModelsCommand] Loaded provider models", { 
    providerCount: providerModels.length 
  });
  serverLogger.info("[ModelsCommand] Recent models", { 
    recent: recent.map(r => `${r.providerID}/${r.modelID}`).slice(0, 5)
  });

  // Build response data
  const data = {
    mode: "dialog" as const,
    recent,
    favorites,
    providers: providerModels
      .filter(p => p.providerID !== "custom") // Exclude the "Custom Provider" option
      .map((p) => ({
        providerID: p.providerID,
        providerName: p.providerName,
        models: p.models.map((m: ModelEntry) => ({
          providerID: m.provider,
          providerName: p.providerName,
          modelID: m.modelId,
          modelName: m.displayName || m.modelId,
          isFavorite: favorites.some(
            (f) => f.providerID === m.provider && f.modelID === m.modelId
          ),
        })),
      }))
      .filter(p => p.models.length > 0), // Only include providers with models
  };

  serverLogger.info("[ModelsCommand] Returning data", { 
    providerCount: data.providers.length, 
    totalModels: data.providers.reduce((sum: number, p) => sum + p.models.length, 0),
    recentCount: data.recent.length,
    favoritesCount: data.favorites.length,
    recentFirst: data.recent[0] ? `${data.recent[0].providerID}/${data.recent[0].modelID}` : null
  });

  return {
    success: true,
    message: "Opening model selection dialog",
    data,
  };
}

/**
 * Handle select action - select a model and switch environment
 */
async function handleSelectAction(
  context: CommandContext,
  modelStore: ModelStore,
  action: ModelsAction
): Promise<CommandResult> {
  if (!action.providerID || !action.modelID) {
    return {
      success: false,
      message: "Missing providerID or modelID",
      data: { error: "Invalid selection" },
    };
  }

  // Add to recent
  await modelStore.addRecent(action.providerID, action.modelID);

  // Get variant
  const variant = await modelStore.getVariant(action.providerID, action.modelID);

  // If env supports switchModel, call it
  let switched = false;
  serverLogger.info("[ModelsCommand] handleSelectAction", { 
    hasEnv: !!context.env, 
    hasSwitchModel: context.env ? "switchModel" in context.env : false,
    providerID: action.providerID,
    modelID: action.modelID
  });
  if (context.env && "switchModel" in context.env) {
    try {
      switched = await (context.env as any).switchModel(
        action.providerID,
        action.modelID
      );
      serverLogger.info("[ModelsCommand] switchModel result", { switched, providerID: action.providerID, modelID: action.modelID });
    } catch (error) {
      serverLogger.error("[ModelsCommand] Failed to switch model", { error: String(error) });
    }
  } else {
    serverLogger.warn("[ModelsCommand] switchModel not called - env doesn't support it");
  }

  // Return failure if model switch failed
  if (!switched) {
    return {
      success: false,
      message: `Failed to switch model: no API key or invalid model for ${action.providerID}/${action.modelID}`,
      data: {
        providerID: action.providerID,
        modelID: action.modelID,
        variant,
        switched: false,
      },
    };
  }

  return {
    success: true,
    message: `Model selected: ${action.providerID}/${action.modelID}`,
    data: {
      providerID: action.providerID,
      modelID: action.modelID,
      variant,
      switched,
    },
  };
}

/**
 * Handle toggle favorite action
 */
async function handleToggleFavoriteAction(
  modelStore: ModelStore,
  action: ModelsAction
): Promise<CommandResult> {
  if (!action.providerID || !action.modelID) {
    return {
      success: false,
      message: "Missing providerID or modelID",
    };
  }

  const isFavorite = await modelStore.toggleFavorite(
    action.providerID,
    action.modelID
  );

  return {
    success: true,
    message: isFavorite ? "Added to favorites" : "Removed from favorites",
    data: { isFavorite },
  };
}

/**
 * Handle set variant action
 */
async function handleSetVariantAction(
  modelStore: ModelStore,
  action: ModelsAction
): Promise<CommandResult> {
  if (!action.providerID || !action.modelID || !action.variant) {
    return {
      success: false,
      message: "Missing required parameters",
    };
  }

  await modelStore.setVariant(
    action.providerID,
    action.modelID,
    action.variant
  );

  return {
    success: true,
    message: "Variant updated",
    data: { variant: action.variant },
  };
}
