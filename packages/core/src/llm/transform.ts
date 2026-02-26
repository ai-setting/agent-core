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

    // MiniMax models require special handling for tool calls
    if (model.id.toLowerCase().includes("minimax")) {
      result = handleMiniMaxMessages(result);
    }

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
   * MiniMax-specific message handling
   * MiniMax doesn't support content arrays with tool-call types in OpenAI-compatible mode
   * Need to convert to standard format
   */
  function handleMiniMaxMessages(msgs: ModelMessage[]): ModelMessage[] {
    return msgs.map((msg) => {
      // Handle assistant messages with content array containing tool-calls
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        const textParts: any[] = [];
        const toolCalls: any[] = [];

        for (const part of msg.content) {
          if (part.type === "text") {
            textParts.push(part);
          } else if (part.type === "tool-call") {
            // Convert to MiniMax-compatible format
            const toolPart = part as any;
            toolCalls.push({
              id: toolPart.toolCallId,
              type: "function",
              function: {
                name: toolPart.toolName,
                arguments: JSON.stringify(toolPart.args || {}),
              },
            });
          }
        }

        // If we have tool calls, return with tool_calls field
        if (toolCalls.length > 0) {
          const textContent = textParts.map((p) => p.text).join("\n");
          return {
            role: "assistant",
            content: textContent || null,
            tool_calls: toolCalls,
          } as unknown as ModelMessage;
        }

        // Otherwise just return text parts
        if (textParts.length > 0) {
          return {
            ...msg,
            content: textParts.length === 1 ? textParts[0] : textParts,
          };
        }
      }

      // Handle tool messages - ensure they have tool_call_id
      if (msg.role === "tool" && !(msg as any).toolCallId) {
        transformLogger.warn("MiniMax tool message missing toolCallId", { msg });
      }

      return msg;
    });
  }

  /**
   * OpenAI-specific message handling
   * Currently no special handling needed as OpenAI has best compatibility
   */
  function handleOpenAIMessages(msgs: ModelMessage[]): ModelMessage[] {
    return msgs;
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

    // Temperature
    if (options.temperature !== undefined && model.capabilities.temperature) {
      result.temperature = options.temperature;
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
