/**
 * @fileoverview LLM Transform Layer
 * 
 * Handles message normalization and provider-specific transformations.
 * Based on opencode's provider transform patterns.
 */

import type { ModelMessage } from "ai";
import type { ProviderMetadata, ModelMetadata } from "./types.js";
import { createLogger } from "../utils/logger.js";

const transformLogger = createLogger("llm:transform", "server.log");

/**
 * Transform namespace for message normalization
 */
export namespace LLMTransform {
  /**
   * Normalize messages for specific provider
   * Handles format differences between providers
   */
  export function normalizeMessages(
    messages: ModelMessage[],
    provider: ProviderMetadata,
    model: ModelMetadata
  ): ModelMessage[] {
    transformLogger.debug("Normalizing messages", {
      providerId: provider.id,
      modelId: model.id,
      messageCount: messages.length,
    });

    let result = [...messages];

    // Apply provider-specific transformations
    switch (provider.sdkType) {
      case "anthropic":
        result = handleAnthropicMessages(result);
        break;
      case "openai":
        result = handleOpenAIMessages(result);
        break;
      default:
        // openai-compatible usually doesn't need special handling
        break;
    }

    // Apply model-specific transformations
    if (model.id.toLowerCase().includes("mistral")) {
      result = handleMistralMessages(result);
    }
    
    // MiniMax-specific handling
    const isMiniMaxModel = model.id.toLowerCase().includes("minimax");
    transformLogger.info("[normalizeMessages] Checking MiniMax", {
      modelId: model.id,
      isMiniMaxModel,
    });
    
    if (isMiniMaxModel) {
      transformLogger.info("[normalizeMessages] Applying MiniMax handler");
      result = handleMiniMaxMessages(result);
    }

    transformLogger.info("[normalizeMessages] Messages before return", {
      messageCount: result.length,
    });

    return result;
  }

  /**
   * Anthropic-specific message handling:
   * 1. Filter out empty content messages (Anthropic rejects them)
   * 2. Normalize toolCallId format
   */
  function handleAnthropicMessages(msgs: ModelMessage[]): ModelMessage[] {
    return msgs
      .map((msg) => {
        // Handle string content
        if (typeof msg.content === "string") {
          if (msg.content === "") {
            transformLogger.debug("Filtering empty string message for Anthropic");
            return undefined;
          }
          return msg;
        }

        // Handle array content
        if (Array.isArray(msg.content)) {
          // Filter empty text/reasoning parts
          const filtered = msg.content.filter((part: any) => {
            if (part.type === "text" || part.type === "reasoning") {
              return part.text !== "";
            }
            return true;
          });

          if (filtered.length === 0) {
            transformLogger.debug("Filtering message with all empty parts for Anthropic");
            return undefined;
          }

          // Normalize toolCallId for Anthropic (only alphanumeric, underscore, hyphen)
          const normalizedParts = filtered.map((part: any) => {
            if (
              (part.type === "tool-call" || part.type === "tool-result") &&
              "toolCallId" in part
            ) {
              return {
                ...part,
                toolCallId: part.toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_"),
              };
            }
            return part;
          });

          return { ...msg, content: normalizedParts } as ModelMessage;
        }

        return msg;
      })
      .filter((msg): msg is ModelMessage => msg !== undefined);
  }

  /**
   * Mistral-specific message handling:
   * 1. toolCallId must be exactly 9 alphanumeric characters
   * 2. Tool messages cannot be followed by user messages
   */
  function handleMistralMessages(msgs: ModelMessage[]): ModelMessage[] {
    const result: ModelMessage[] = [];

    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i];
      const nextMsg = msgs[i + 1];

      // Clone message to avoid mutating original
      let processedMsg = { ...msg } as any;

      // Normalize toolCallId to exactly 9 alphanumeric characters
      if (Array.isArray(processedMsg.content)) {
        processedMsg.content = processedMsg.content.map((part: any) => {
          if (
            (part.type === "tool-call" || part.type === "tool-result") &&
            "toolCallId" in part
          ) {
            const normalizedId = part.toolCallId
              .replace(/[^a-zA-Z0-9]/g, "") // Remove non-alphanumeric
              .substring(0, 9) // Take first 9 characters
              .padEnd(9, "0"); // Pad with zeros if less than 9

            return {
              ...part,
              toolCallId: normalizedId,
            };
          }
          return part;
        });
      }

      result.push(processedMsg);

      // Mistral requires: tool message must be followed by assistant message
      // If tool is followed by user, insert an empty assistant message
      if (processedMsg.role === "tool" && nextMsg?.role === "user") {
        transformLogger.debug("Inserting empty assistant message after tool for Mistral");
        result.push({
          role: "assistant",
          content: [{ type: "text", text: "Done." }],
        } as ModelMessage);
      }
    }

    return result;
  }

  /**
   * OpenAI-specific message handling
   * Currently no special handling needed as OpenAI has best compatibility
   */
  function handleOpenAIMessages(msgs: ModelMessage[]): ModelMessage[] {
    return msgs;
  }

  /**
   * MiniMax-specific message handling
   * MiniMax expects tool-call arguments as JSON string, not object
   */
  function handleMiniMaxMessages(msgs: ModelMessage[]): ModelMessage[] {
    transformLogger.info("[handleMiniMaxMessages] Starting conversion", {
      messageCount: msgs.length,
    });
    
    return msgs.map((msg) => {
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
        return msg;
      }

      // Clone message to avoid mutating original
      const processedMsg = { ...msg } as any;

      // Convert tool-call args from object to string for MiniMax
      processedMsg.content = msg.content.map((part: any) => {
        transformLogger.info("[handleMiniMaxMessages] Processing part", {
          partType: part.type,
          hasArgs: !!part.args,
          argsType: typeof part.args,
        });
        
        if (part.type === "tool-call" && part.args && typeof part.args === "object") {
          const stringifiedArgs = JSON.stringify(part.args);
          transformLogger.info("[handleMiniMaxMessages] Converting args to string", {
            toolName: part.toolName,
            originalArgs: part.args,
            stringifiedArgs,
          });
          return {
            ...part,
            args: stringifiedArgs,
          };
        }
        return part;
      });

      return processedMsg;
    });
  }

  /**
   * Generate provider-specific options
   * Handles parameter name differences between providers
   */
  export function generateProviderOptions(
    provider: ProviderMetadata,
    model: ModelMetadata,
    options: {
      temperature?: number;
      maxTokens?: number;
      variant?: string; // e.g., "high", "max" for reasoning effort
    }
  ): Record<string, any> {
    const result: Record<string, any> = {};

    // Temperature - handle provider-specific constraints
    transformLogger.debug("[generateProviderOptions] Processing temperature", {
      optionsTemperature: options.temperature,
      modelCapabilities: model.capabilities,
      providerId: provider.id,
      modelId: model.id,
    });
    
    if (options.temperature !== undefined && model.capabilities?.temperature) {
      let temperature = options.temperature;
      
      // ZhipuAI GLM models only accept temperature=1
      const isZhipuAI = provider.id === "zhipuai";
      const isGLMModel = model.id.includes("glm");
      
      transformLogger.debug("[generateProviderOptions] Checking ZhipuAI/GLM", {
        isZhipuAI,
        isGLMModel,
        providerId: provider.id,
        modelId: model.id,
      });
      
      if (isZhipuAI || isGLMModel) {
        temperature = 1;
        transformLogger.info("[generateProviderOptions] Forcing temperature=1 for ZhipuAI/GLM model", { 
          providerId: provider.id,
          modelId: model.id,
          originalTemp: options.temperature 
        });
      }
      
      result.temperature = temperature;
      transformLogger.info("[generateProviderOptions] Setting temperature", { 
        temperature,
        providerId: provider.id,
        modelId: model.id 
      });
    } else {
      transformLogger.debug("[generateProviderOptions] Skipping temperature", {
        hasOptionsTemp: options.temperature !== undefined,
        modelCapTemp: model.capabilities?.temperature,
      });
    }

    // Max tokens
    if (options.maxTokens !== undefined) {
      result.maxTokens = Math.min(
        options.maxTokens,
        model.limits.maxOutputTokens || Infinity
      );
    }

    // Provider-specific reasoning/thinking options
    switch (provider.sdkType) {
      case "anthropic":
        if (model.capabilities.reasoning && options.variant) {
          result.providerOptions = {
            anthropic: {
              thinking: {
                type: "enabled",
                budgetTokens: getThinkingBudget(options.variant, model),
              },
            },
          };
        }
        break;

      case "openai":
        if (model.capabilities.reasoning && options.variant) {
          result.providerOptions = {
            openai: {
              reasoningEffort: options.variant,
            },
          };
        }
        break;
    }

    return result;
  }

  /**
   * Calculate thinking budget based on variant and model limits
   */
  function getThinkingBudget(variant: string, model: ModelMetadata): number {
    const maxOutput = model.limits.maxOutputTokens || 32000;

    switch (variant) {
      case "high":
        return Math.min(16000, Math.floor(maxOutput / 2 - 1));
      case "max":
        return Math.min(31999, maxOutput - 1);
      default:
        return 16000;
    }
  }

  /**
   * Apply caching control for supported providers
   */
  export function applyCaching(
    messages: ModelMessage[],
    provider: ProviderMetadata
  ): ModelMessage[] {
    // Only apply to providers that support caching
    if (provider.sdkType !== "anthropic") {
      return messages;
    }

    // Cache system messages and recent non-system messages
    const systemMsgs = messages.filter((m) => m.role === "system").slice(0, 2);
    const recentMsgs = messages.filter((m) => m.role !== "system").slice(-2);
    const toCache = new Set([...systemMsgs, ...recentMsgs]);

    return messages.map((msg) => {
      if (!toCache.has(msg)) return msg;

      return {
        ...msg,
        providerOptions: {
          ...msg.providerOptions,
          anthropic: {
            cacheControl: { type: "ephemeral" },
          },
        },
      };
    });
  }
}
