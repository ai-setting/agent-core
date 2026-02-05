/**
 * @fileoverview LLM adapter transform utilities.
 * Handles provider-specific parameter tuning and options transformation.
 */

import type { LLMMessage, LLMConfig } from "./index.js";

export interface ModelInfo {
  provider: string;
  model: string;
  fullName: string;
  apiNpm?: string;
  supportsReasoning?: boolean;
  reasoningField?: "reasoning_content" | "reasoning_details";
}

export interface TransformedConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  providerOptions?: Record<string, unknown>;
}

export namespace LLMTransform {
  export function getDefaultTemperature(model: ModelInfo): number | undefined {
    const id = model.model.toLowerCase();

    if (id.includes("qwen") || id.includes("glm")) return 0.55;
    if (id.includes("claude")) return undefined;
    if (id.includes("gemini")) return 1.0;
    if (id.includes("kimi") || id.includes("k2p5")) {
      if (id.includes("thinking")) return 1.0;
      return 1.0;
    }
    if (id.includes("minimax")) return 0.95;
    return undefined;
  }

  export function getDefaultTopP(model: ModelInfo): number | undefined {
    const id = model.model.toLowerCase();

    if (id.includes("qwen")) return 1.0;
    if (id.includes("minimax") || id.includes("kimi") || id.includes("gemini")) return 0.95;
    return undefined;
  }

  export function getDefaultTopK(model: ModelInfo): number | undefined {
    const id = model.model.toLowerCase();

    if (id.includes("minimax")) {
      return id.includes("m2.1") ? 40 : 20;
    }
    if (id.includes("gemini")) return 64;
    return undefined;
  }

  export function transformMessages(messages: LLMMessage[], model: ModelInfo): LLMMessage[] {
    if (model.provider === "anthropic" || (model.apiNpm && model.apiNpm.includes("anthropic"))) {
      return messages.filter((msg) => {
        if (typeof msg.content === "string") {
          return msg.content !== "";
        }
        return true;
      });
    }
    return messages;
  }

  export function getProviderOptions(model: ModelInfo, sessionId?: string): Record<string, unknown> {
    const options: Record<string, unknown> = {};
    const npm = model.apiNpm || "";

    if (
      model.provider === "openai" ||
      npm.includes("@ai-sdk/openai") ||
      npm.includes("@ai-sdk/github-copilot")
    ) {
      options["store"] = false;
    }

    if (npm.includes("@openrouter/ai-sdk-provider")) {
      options["usage"] = { include: true };
    }

    if (sessionId && (model.provider === "openai" || npm.includes("@ai-sdk/openai"))) {
      options["promptCacheKey"] = sessionId;
    }

    if (model.provider === "google" || npm.includes("@ai-sdk/google")) {
      options["thinkingConfig"] = { includeThoughts: true };
    }

    return options;
  }

  export function transformConfig(
    config: Partial<LLMConfig>,
    model: ModelInfo,
    sessionId?: string,
  ): TransformedConfig {
    return {
      temperature: config.temperature ?? getDefaultTemperature(model),
      topP: config.topP ?? getDefaultTopP(model),
      topK: config.topK ?? getDefaultTopK(model),
      providerOptions: getProviderOptions(model, sessionId),
    };
  }
}
