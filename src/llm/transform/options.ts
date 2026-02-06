/**
 * @fileoverview Provider-specific options transformation.
 */

export interface TransformOptions {
  modelID: string;
  providerID: string;
  npmPackage: string;
  sessionID?: string;
}

export function transformOptions(input: TransformOptions): Record<string, unknown> {
  const { modelID, providerID, npmPackage, sessionID } = input;
  const result: Record<string, unknown> = {};
  const id = modelID.toLowerCase();

  if (npmPackage === "@ai-sdk/openai") {
    result["store"] = false;
  }

  if (npmPackage === "@openrouter/ai-sdk-provider") {
    result["usage"] = { include: true };
  }

  if ((id.includes("kimi-k2") || id.includes("k2p5")) && npmPackage === "@ai-sdk/openai-compatible") {
    result["thinking"] = { type: "enabled", clear_thinking: false };
  }

  if (npmPackage === "@ai-sdk/google") {
    result["thinkingConfig"] = { includeThoughts: true };
  }

  if (sessionID && (npmPackage === "@ai-sdk/openai" || providerID === "openai")) {
    result["promptCacheKey"] = sessionID;
  }

  return result;
}

export function getDefaultTemperature(modelID: string, providerID: string): number | undefined {
  const id = modelID.toLowerCase();

  if (providerID === "kimi" || id.includes("kimi-k2")) {
    if (id.includes("thinking") || id.includes("k2.") || id.includes("k2p")) {
      return 1.0;
    }
    return 0.6;
  }

  if (id.includes("qwen")) return 0.55;

  return undefined;
}

export function getDefaultTopP(modelID: string): number | undefined {
  const id = modelID.toLowerCase();

  if (id.includes("kimi") || id.includes("minimax") || id.includes("deepseek")) {
    return 0.95;
  }

  return undefined;
}

export function getDefaultTopK(modelID: string): number | undefined {
  const id = modelID.toLowerCase();

  if (id.includes("minimax")) {
    return id.includes("m2.1") ? 40 : 20;
  }

  if (id.includes("gemini")) return 64;

  return undefined;
}
