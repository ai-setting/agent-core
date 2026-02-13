/**
 * @fileoverview Models Command - Model selection and management
 *
 * Manages model selection with persistent storage of recent/favorites
 * Integrates with ModelStore and Providers system
 */

import type { Command, CommandContext, CommandResult } from "../types.js";
import { ModelStore } from "../../../config/state/model-store.js";
import { Providers_getAll } from "../../../config/providers.js";

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
 * Handle list action - return all providers and models
 */
async function handleListAction(modelStore: ModelStore): Promise<CommandResult> {
  // Load all providers
  const providers = await Providers_getAll();
  const recent = await modelStore.getRecent();
  const favorites = await modelStore.getFavorite();

  console.log("[ModelsCommand] Loaded providers:", providers.length);
  console.log("[ModelsCommand] Providers with models:", providers.map(p => ({ id: p.id, modelsCount: p.models?.length || 0 })));

  // Build response data
  const data = {
    mode: "dialog" as const,
    recent,
    favorites,
    providers: providers
      .filter(p => p.id !== "custom") // Exclude the "Custom Provider" option
      .map((p) => ({
        providerID: p.id,
        providerName: p.name,
        models: (p.models || []).map((m) => {
          return {
            providerID: p.id,
            providerName: p.name,
            modelID: m,
            modelName: m,
            isFavorite: favorites.some(
              (f) => f.providerID === p.id && f.modelID === m
            ),
          };
        }),
      }))
      .filter(p => p.models.length > 0), // Only include providers with models
  };

  console.log("[ModelsCommand] Returning data:", { 
    providerCount: data.providers.length, 
    totalModels: data.providers.reduce((sum, p) => sum + p.models.length, 0),
    recentCount: data.recent.length,
    favoritesCount: data.favorites.length
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
  if (context.env && "switchModel" in context.env) {
    try {
      switched = await (context.env as any).switchModel(
        action.providerID,
        action.modelID
      );
    } catch (error) {
      console.error("[ModelsCommand] Failed to switch model:", error);
    }
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
