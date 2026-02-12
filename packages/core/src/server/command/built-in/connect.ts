/**
 * @fileoverview Connect Command - Provider Connection Management
 *
 * Manages provider connections and API key configuration
 */

import type { Command, CommandContext, CommandResult } from "../types.js";
import {
  Auth_get,
  Auth_listProviders,
  Auth_setProvider,
  Auth_removeProvider,
  Auth_getApiKey,
  Auth_getProvider,
} from "../../../config/auth.js";
import type { Config } from "../../../config/types.js";

interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  baseURL?: string;
  hasKey: boolean;
}

const BUILTIN_PROVIDERS: ProviderInfo[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models by Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    hasKey: false,
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT models by OpenAI",
    baseURL: "https://api.openai.com/v1",
    hasKey: false,
  },
  {
    id: "google",
    name: "Google",
    description: "Gemini models by Google",
    baseURL: "https://generativelanguage.googleapis.com/v1",
    hasKey: false,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek models",
    baseURL: "https://api.deepseek.com/v1",
    hasKey: false,
  },
  {
    id: "zhipuai",
    name: "ZhipuAI",
    description: "GLM models by ZhipuAI",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    hasKey: false,
  },
  {
    id: "kimi",
    name: "Kimi",
    description: "Moonshot AI Kimi models",
    baseURL: "https://api.moonshot.cn/v1",
    hasKey: false,
  },
  {
    id: "custom",
    name: "Custom Provider",
    description: "Add a custom LLM provider",
    hasKey: false,
  },
];

interface ConnectAction {
  type: "list" | "add" | "remove" | "set_key";
  providerId?: string;
  providerName?: string;
  baseURL?: string;
  apiKey?: string;
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
        const providers = await getProvidersList();
        return {
          success: true,
          message: "Retrieved providers list",
          data: { providers },
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

        await Auth_setProvider(action.providerId, {
          type: "api",
          key: action.apiKey || "",
          baseURL: action.baseURL,
          metadata: { displayName: action.providerName },
        });

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

        const existing = await Auth_getProvider(action.providerId);
        await Auth_setProvider(action.providerId, {
          type: "api",
          key: action.apiKey,
          baseURL: action.baseURL,
          metadata: existing?.metadata,
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

async function getProvidersList(): Promise<ProviderInfo[]> {
  const auth = await Auth_get();
  const configuredProviders = await Auth_listProviders();

  const providers = BUILTIN_PROVIDERS.map((p) => ({
    ...p,
    hasKey: configuredProviders.includes(p.id) || auth[p.id] !== undefined,
  }));

  const customProviders = Object.entries(auth)
    .filter(([id]) => !BUILTIN_PROVIDERS.find((p) => p.id === id))
    .map(([id, config]) => ({
      id,
      name: (config as Config.Auth[string]).metadata?.displayName || id,
      description: "Custom provider",
      baseURL: (config as Config.Auth[string]).baseURL,
      hasKey: true,
    } as ProviderInfo));

  return [...providers, ...customProviders];
}
