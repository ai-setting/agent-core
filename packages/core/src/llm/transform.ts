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
    
    // Handle interleaved reasoning for models with reasoning capability
    // Extracts reasoning content from messages and places it in providerOptions
    // This is required for models like Kimi k2.5, DeepSeek R1, etc.
    if (model.capabilities.interleaved?.field) {
      transformLogger.info("[normalizeMessages] Applying interleaved reasoning handler", {
        providerId: provider.id,
        modelId: model.id,
        field: model.capabilities.interleaved.field,
      });
      result = handleInterleavedReasoning(result, model);
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
   * Handle interleaved reasoning content
   * Extracts reasoning/thinking parts from assistant messages and places them
   * in providerOptions for models that require this format (e.g., Kimi k2.5, DeepSeek R1)
   * 
   * Inspired by opencode's provider transform patterns:
   * https://github.com/opencode-ai/opencode/blob/main/packages/opencode/src/provider/transform.ts
   */
  function handleInterleavedReasoning(
    msgs: ModelMessage[],
    model: ModelMetadata
  ): ModelMessage[] {
    const field = model.capabilities.interleaved?.field;
    if (!field) {
      return msgs;
    }

    transformLogger.info("[handleInterleavedReasoning] Starting conversion", {
      messageCount: msgs.length,
      modelId: model.id,
      field,
    });

    return msgs.map((msg) => {
      // Only process assistant messages with array content
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
        return msg;
      }

      // Extract reasoning parts (both 'reasoning' type and <think> tags)
      const reasoningParts: string[] = [];
      const otherParts: any[] = [];

      for (const part of msg.content as any[]) {
        if (part.type === "reasoning") {
          reasoningParts.push(part.text);
        } else if (part.type === "text" && part.text?.startsWith("<think>") && part.text?.endsWith("</think>")) {
          // Extract reasoning from <think> tags (added by agent/index.ts)
          const reasoning = part.text.slice(7, -8); // Remove <think> and </think>
          reasoningParts.push(reasoning);
        } else {
          otherParts.push(part);
        }
      }

      // If we have reasoning content, add it to providerOptions
      if (reasoningParts.length > 0) {
        const reasoningText = reasoningParts.join("\n");
        transformLogger.info("[handleInterleavedReasoning] Adding reasoning to providerOptions", {
          field,
          reasoningLength: reasoningText.length,
          messageHasToolCalls: otherParts.some((p: any) => p.type === "tool-call"),
        });

        return {
          ...msg,
          content: otherParts,
          providerOptions: {
            ...msg.providerOptions,
            openaiCompatible: {
              ...(msg.providerOptions as any)?.openaiCompatible,
              [field]: reasoningText,
            },
          },
        };
      }

      return msg;
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
      
      // Kimi k2.5 models only accept temperature=1
      const isKimi = provider.id === "kimi";
      const isKimiK25 = model.id.toLowerCase().includes("kimi-k2.5") || 
                       model.id.toLowerCase().includes("kimi-k2") ||
                       model.id.toLowerCase().includes("k2.5");
      
      if (isKimi && isKimiK25) {
        temperature = 1;
        transformLogger.info("[generateProviderOptions] Forcing temperature=1 for Kimi k2.5 model", { 
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
