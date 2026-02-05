/**
 * @fileoverview OpenAI API adapter for LLM interactions.
 * Implements the LLMAdapter interface for OpenAI's Chat Completions API.
 */

import {
  LLMAdapter,
  LLMConfig,
  LLMMessage,
  LLMCompleteParams,
  LLMStreamParams,
  LLMCallbacks,
  LLMResponse,
  LLMResult,
  LLMUsage,
  LLMToolCall,
  LLMProviderType,
  parseModel,
} from "../index.js";
import { LLMTransform, type ModelInfo } from "../transform.js";

/**
 * OpenAI-specific configuration.
 */
export interface OpenAIConfig {
  apiKey: string;
  organization?: string;
  baseURL?: string;
  timeout?: number;
  defaultModel?: string;
  headers?: Record<string, string>;
}

/**
 * OpenAI Chat Completion request body.
 */
interface OpenAIChatRequest {
  model: string;
  messages: Array<{
    role: string;
    content: string;
    name?: string;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  stream?: boolean;
  response_format?: { type: string };
}

/**
 * OpenAI Chat Completion response chunk (streaming).
 */
interface OpenAIChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta?: {
      role?: string;
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        id: string;
        index: number;
        type: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
    logprobs?: unknown;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI Chat Completion response (non-streaming).
 */
interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string | null;
    logprobs?: unknown;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI API adapter implementation.
 */
export class OpenAIAdapter implements LLMAdapter {
  readonly name: LLMProviderType = "openai";
  readonly displayName = "OpenAI";
  private config: Required<OpenAIConfig>;

  constructor(config: OpenAIConfig) {
    this.config = {
      apiKey: config.apiKey,
      organization: config.organization ?? "",
      baseURL: config.baseURL ?? "https://api.openai.com/v1",
      timeout: config.timeout ?? 60000,
      defaultModel: config.defaultModel ?? "gpt-4",
      headers: config.headers ?? {},
    };
  }

  isConfigured(): boolean {
    return !!this.config.apiKey && this.config.apiKey.length > 0;
  }

  getDefaultModel(): string {
    return this.config.defaultModel;
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.config.baseURL}/models`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to list models: ${response.statusText}`);
      }

      const data = (await response.json()) as { data: Array<{ id: string }> };
      return data.data.map((m) => m.id).filter((id) => id.startsWith("gpt"));
    } catch (error) {
      console.error("Failed to list OpenAI models:", error);
      return [];
    }
  }

  async complete(params: LLMCompleteParams): Promise<LLMResponse> {
    if (!this.isConfigured()) {
      return {
        message: "OpenAI API key not configured",
        retryable: false,
      };
    }

    const request = this.buildRequest(params);

    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(request),
        signal: params.abort,
      });

      if (!response.ok) {
        const error = await this.parseError(response);
        return error;
      }

      const data = (await response.json()) as OpenAIResponse;
      return this.parseResponse(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        message,
        retryable: this.isRetryableError(message),
      };
    }
  }

  async stream(params: LLMStreamParams, callbacks: LLMCallbacks): Promise<void> {
    if (!this.isConfigured()) {
      callbacks.onError?.(new Error("OpenAI API key not configured"));
      return;
    }

    const request = this.buildRequest(params);
    request.stream = true;

    callbacks.onStart?.();

    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(request),
        signal: params.abort,
      });

      if (!response.ok) {
        const error = await this.parseError(response);
        callbacks.onError?.(new Error(error.message));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError?.(new Error("Failed to get response reader"));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          callbacks.onComplete?.();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          this.parseChunk(line, callbacks);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      callbacks.onError?.(new Error(message));
    }
  }

  private parseChunk(line: string, callbacks: LLMCallbacks): void {
    const trimmed = line.trim();

    if (!trimmed) return;

    if (trimmed === "[DONE]" || trimmed === "data: [DONE]") {
      callbacks.onComplete?.();
      return;
    }

    if (!trimmed.startsWith("data: ")) return;

    const data = trimmed.slice(6);

    if (data === "[DONE]") {
      callbacks.onComplete?.();
      return;
    }

    try {
      const chunk = JSON.parse(data) as OpenAIChunk;
      const choice = chunk.choices?.[0];

      if (!choice) return;

      if (choice.finish_reason) {
        callbacks.onComplete?.();
        return;
      }

      const delta = choice.delta;

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.function?.name) {
            callbacks.onToolCall?.(
              tc.function.name,
              tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
              tc.id,
            );
          }
        }
      }

      if (delta?.reasoning_content) {
        callbacks.onContent?.(delta.reasoning_content, "reasoning");
      }

      if (delta?.content) {
        callbacks.onContent?.(delta.content, "text");
      }
    } catch {
      // Ignore parse errors
    }
  }

  private buildRequest(params: LLMCompleteParams | LLMStreamParams): OpenAIChatRequest {
    const { messages, config } = params;
    const modelConfig = config?.model ?? this.config.defaultModel;

    const parsed = parseModel(modelConfig);

    const modelInfo: ModelInfo = {
      provider: parsed.provider,
      model: parsed.model,
      fullName: parsed.fullName,
      apiNpm: "@ai-sdk/openai-compatible",
    };

    const transformedConfig = LLMTransform.transformConfig(config || {}, modelInfo);
    const transformedMessages = LLMTransform.transformMessages(messages, modelInfo);

    return {
      model: parsed.model,
      messages: transformedMessages.map((m) => this.formatMessage(m)),
      temperature: transformedConfig.temperature,
      max_tokens: config?.maxTokens,
      top_p: transformedConfig.topP,
      frequency_penalty: config?.frequencyPenalty,
      presence_penalty: config?.presencePenalty,
      stop: config?.stop,
      stream: false,
      response_format: config?.responseFormat,
      ...(transformedConfig.providerOptions || {}),
    };
  }

  private formatMessage(msg: LLMMessage): {
    role: string;
    content: string;
    name?: string;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  } {
    const result: {
      role: string;
      content: string;
      name?: string;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    } = {
      role: msg.role,
      content: msg.content,
    };

    if (msg.name) {
      result.name = msg.name;
    }

    if (msg.toolCalls && msg.toolCalls.length > 0) {
      result.tool_calls = msg.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));
    }

    return result;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      ...this.config.headers,
    };

    if (this.config.organization) {
      headers["OpenAI-Organization"] = this.config.organization;
    }

    return headers;
  }

  private parseResponse(response: OpenAIResponse): LLMResult {
    const choice = response.choices[0];
    const usage: LLMUsage = {
      inputTokens: response.usage.prompt_tokens,
      outputTokens: response.usage.completion_tokens,
      totalTokens: response.usage.total_tokens,
    };

    const toolCalls: LLMToolCall[] = choice.message.tool_calls?.map((tc) => ({
      id: tc.id,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    })) ?? [];

    return {
      success: true,
      content: choice.message.content || "",
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    };
  }

  private async parseError(response: Response): Promise<{ message: string; code?: string; retryable: boolean }> {
    try {
      const error = (await response.json()) as { error?: { message?: string; type?: string; code?: string } };
      const message = error.error?.message || response.statusText;
      const code = error.error?.code;
      const retryable = response.status >= 500 || response.status === 429;
      return { message, code, retryable };
    } catch {
      return { message: response.statusText, retryable: response.status >= 500 };
    }
  }

  private isRetryableError(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    return (
      lowerMessage.includes("timeout") ||
      lowerMessage.includes("rate limit") ||
      lowerMessage.includes("server error") ||
      lowerMessage.includes("service unavailable")
    );
  }
}

export function createOpenAIAdapterFromEnv(): OpenAIAdapter | undefined {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return undefined;
  return new OpenAIAdapter({
    apiKey,
    organization: process.env.OPENAI_ORG_ID,
    baseURL: process.env.OPENAI_BASE_URL,
    defaultModel: process.env.OPENAI_DEFAULT_MODEL || "gpt-4",
  });
}
