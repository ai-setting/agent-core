/**
 * @fileoverview LLM Client - Unified interface for LLM calls.
 */

import { createProvider, type SDKInstance, type ProviderOptions } from "./provider/index.js";
import { transformMessages, transformOptions, getDefaultTemperature, getDefaultTopP } from "./transform/index.js";
import type { ToolInfo } from "../types/tool.js";

export interface LLMClientOptions {
  model: string;
  apiKey?: string;
  baseURL?: string;
  temperature?: number | null;
  maxTokens?: number;
  sessionID?: string;
}

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
}

export class LLMClient {
  private sdk: SDKInstance;
  private options: {
    model: string;
    apiKey: string;
    baseURL: string;
    temperature?: number;
    maxTokens: number;
    sessionID: string;
  };

  constructor(options: LLMClientOptions) {
    const { providerID, modelID } = this.parseModel(options.model);

    this.sdk = createProvider({
      providerID,
      modelID,
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });

    this.options = {
      model: options.model,
      apiKey: options.apiKey || process.env[`${providerID.toUpperCase()}_API_KEY`] || "",
      baseURL: options.baseURL || "",
      temperature: options.temperature ?? getDefaultTemperature(modelID, providerID) ?? undefined,
      maxTokens: options.maxTokens || 4096,
      sessionID: options.sessionID || "",
    };
  }

  private parseModel(model: string): { providerID: string; modelID: string } {
    const parts = model.split("/");
    if (parts.length === 1) {
      return { providerID: "openai", modelID: model };
    }
    return { providerID: parts[0], modelID: parts.slice(1).join("/") };
  }

  async complete(
    messages: Array<{ role: string; content: string; name?: string; tool_calls?: unknown[]; tool_call_id?: string }>,
    tools?: ToolInfo[],
  ): Promise<LLMResponse> {
    const startTime = Date.now();

    const transformedMessages = transformMessages(
      messages,
      this.sdk.providerID,
      this.sdk.modelID,
    );

    const providerOptions = transformOptions({
      modelID: this.sdk.modelID,
      providerID: this.sdk.providerID,
      npmPackage: this.sdk.npmPackage,
      sessionID: this.options.sessionID,
    });

    const toolDefs = tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description || "",
        parameters: t.parameters,
      },
    }));

    const callOptions: Record<string, unknown> = {
      messages: transformedMessages,
      ...providerOptions,
      temperature: this.options.temperature,
      maxTokens: this.options.maxTokens,
    };

    if (toolDefs && toolDefs.length > 0) {
      (callOptions as Record<string, unknown>).tools = toolDefs;
    }

    const result = await (this.sdk.languageModel as {
      doCall?: (options: Record<string, unknown>) => Promise<{
        output: unknown;
        usage?: { inputTokens?: number; outputTokens?: number };
      }>;
    }).doCall?.(callOptions);

    const response = this.parseResponse(result?.output);

    return {
      ...response,
      usage: result?.usage
        ? {
            inputTokens: result.usage.inputTokens || 0,
            outputTokens: result.usage.outputTokens || 0,
            totalTokens: (result.usage.inputTokens || 0) + (result.usage.outputTokens || 0),
          }
        : undefined,
    };
  }

  private parseResponse(output: unknown): Omit<LLMResponse, "usage"> {
    if (!output) {
      return { content: "" };
    }

    const outputObj = output as { messages?: Array<{ role: string; content: unknown }> };
    const messages = outputObj.messages || [];

    const assistantMessages = messages.filter((m) => m.role === "assistant");
    const lastMessage = assistantMessages[assistantMessages.length - 1];

    if (!lastMessage) {
      return { content: "" };
    }

    let content = "";
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    if (typeof lastMessage.content === "string") {
      content = lastMessage.content;
    } else if (Array.isArray(lastMessage.content)) {
      const parts = lastMessage.content as Array<{ type: string; text?: string; toolCallId?: string; name?: string }>;
      for (const part of parts) {
        if (part.type === "text" && part.text) {
          content += part.text;
        } else if (part.type === "tool-call" && part.toolCallId) {
          toolCalls.push({
            id: part.toolCallId,
            name: part.name || "",
            arguments: JSON.stringify(part),
          });
        }
      }
    }

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }
}

export function createLLMClient(options: LLMClientOptions): LLMClient {
  return new LLMClient(options);
}
