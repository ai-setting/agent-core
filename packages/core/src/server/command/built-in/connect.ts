/**
 * @fileoverview Connect Command - Provider Connection Management
 *
 * Manages provider connections and API key configuration
 * Stores provider metadata in providers.jsonc and API keys in auth.json
 */

import type { Command, CommandContext, CommandResult } from "../types.js";
import {
  Auth_get,
  Auth_listProviders,
  Auth_setProvider,
  Auth_removeProvider,
  Auth_getProvider,
} from "../../../config/auth.js";
import {
  Providers_load,
  Providers_save,
  Providers_getAll,
  type ProviderInfo,
} from "../../../config/providers.js";
import type { Config } from "../../../config/types.js";

interface ConnectAction {
  type: "list" | "add" | "remove" | "set_key";
  providerId?: string;
  providerName?: string;
  baseURL?: string;
  apiKey?: string;
  models?: string[];
  description?: string;
}

export const connectCommand: Command = {
  name: "connect",
  displayName: "Connect",
  description: "Connect to an LLM provider and configure API keys",
  hasArgs: false,

  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    let action: ConnectAction;

    try {
      action = args ? JSON.parse(args) : { type: "list" };
    } catch {
      return {
        success: false,
        message: "Invalid arguments. Use empty args to list providers.",
        data: { error: "Invalid JSON arguments" },
      };
    }

    switch (action.type) {
      case "list": {
        const providers = await Providers_getAll();
        // Check which providers have API keys
        const auth = await Auth_get();
        const providersWithKeyStatus = providers.map((p) => ({
          ...p,
          hasKey: !!auth[p.id]?.key,
        }));
        
        return {
          success: true,
          message: "Retrieved providers list",
          data: { providers: providersWithKeyStatus },
        };
      }

      case "add": {
        if (!action.providerId || !action.providerName) {
          return {
            success: false,
            message: "Missing providerId or providerName",
            data: { error: "providerId and providerName are required" },
          };
        }

        // Save provider metadata to providers.jsonc
        const providers = await Providers_load();
        providers[action.providerId] = {
          id: action.providerId,
          name: action.providerName,
          description: action.description || "Custom provider",
          baseURL: action.baseURL,
          models: action.models,
        };
        await Providers_save(providers);

        // Save API key to auth.json if provided
        if (action.apiKey) {
          await Auth_setProvider(action.providerId, {
            type: "api",
            key: action.apiKey,
            baseURL: action.baseURL,
            metadata: { displayName: action.providerName },
          });
        }

        return {
          success: true,
          message: `Provider "${action.providerName}" added successfully`,
          data: { providerId: action.providerId },
        };
      }

      case "remove": {
        if (!action.providerId) {
          return {
            success: false,
            message: "Missing providerId",
            data: { error: "providerId is required" },
          };
        }

        // Remove from providers.jsonc
        const providers = await Providers_load();
        delete providers[action.providerId];
        await Providers_save(providers);

        // Remove from auth.json
        await Auth_removeProvider(action.providerId);

        return {
          success: true,
          message: `Provider removed successfully`,
          data: { providerId: action.providerId },
        };
      }

      case "set_key": {
        if (!action.providerId || !action.apiKey) {
          return {
            success: false,
            message: "Missing providerId or apiKey",
            data: { error: "providerId and apiKey are required" },
          };
        }

        // Get existing provider info
        const providers = await Providers_load();
        const providerInfo = providers[action.providerId];
        const existing = await Auth_getProvider(action.providerId);
        
        await Auth_setProvider(action.providerId, {
          type: "api",
          key: action.apiKey,
          baseURL: action.baseURL || providerInfo?.baseURL || existing?.baseURL,
          metadata: existing?.metadata || { displayName: providerInfo?.name || action.providerId },
        });

        return {
          success: true,
          message: `API key set for provider`,
          data: { providerId: action.providerId },
        };
      }

      default:
        return {
          success: false,
          message: `Unknown action type: ${(action as ConnectAction).type}`,
          data: { error: "Unknown action type" },
        };
    }
  },
};
