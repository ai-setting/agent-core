/**
 * @fileoverview Mock LLM adapter for testing without real API calls.
 * Provides deterministic responses for unit and integration testing.
 */

import type {
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
} from "../../src/environment/llm/index.js";

/**
 * Configuration for MockLLMAdapter.
 */
export interface MockLLMAdapterConfig {
  /** Simulated response text. */
  responseText?: string;

  /** Simulated tool calls to return. */
  toolCalls?: LLMToolCall[];

  /** Whether to simulate streaming. */
  streamResponses?: boolean;

  /** Delay before response in ms. */
  responseDelayMs?: number;

  /** Error to simulate (if any). */
  errorToThrow?: Error;

  /** Whether the error is retryable. */
  retryableError?: boolean;

  /** Token usage to report. */
  usage?: LLMUsage;
}

/**
 * Creates a mock LLM adapter for testing.
 *
 * @param config - Mock configuration
 * @returns Mock adapter instance
 *
 * @example
 * ```typescript
 * const adapter = createMockAdapter({
 *   responseText: "Hello, world!",
 *   toolCalls: [{ id: "1", function: { name: "bash", arguments: "{}" }]
 * });
 *
 * const result = await adapter.complete({
 *   messages: [{ role: "user", content: "Say hello" }]
 * });
 * ```
 */
export function createMockAdapter(config: MockLLMAdapterConfig): LLMAdapter {
  return new MockLLMAdapter(config);
}

/**
 * Mock LLM adapter implementation for testing.
 */
export class MockLLMAdapter implements LLMAdapter {
  readonly name: LLMProviderType = "mock";
  readonly displayName = "Mock LLM";

  private config: Required<MockLLMAdapterConfig>;

  constructor(config: MockLLMAdapterConfig) {
    this.config = {
      responseText: config.responseText ?? "Mock response",
      toolCalls: config.toolCalls ?? [],
      streamResponses: config.streamResponses ?? true,
      responseDelayMs: config.responseDelayMs ?? 10,
      errorToThrow: config.errorToThrow,
      retryableError: config.retryableError ?? false,
      usage: config.usage ?? { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
  }

  /** @inheritdoc */
  isConfigured(): boolean {
    return true;
  }

  /** @inheritdoc */
  getDefaultModel(): string {
    return "mock-model-1";
  }

  /** @inheritdoc */
  async listModels(): Promise<string[]> {
    return ["mock-model-1", "mock-model-2", "mock-model-3"];
  }

  /** @inheritdoc */
  async complete(params: LLMCompleteParams): Promise<LLMResponse> {
    await this.delay();

    if (this.config.errorToThrow) {
      return {
        success: false,
        message: this.config.errorToThrow.message,
        retryable: this.config.retryableError,
      };
    }

    return {
      success: true,
      content: this.config.responseText,
      toolCalls: this.config.toolCalls.length > 0 ? this.config.toolCalls : undefined,
      usage: this.config.usage,
    };
  }

  /** @inheritdoc */
  async stream(params: LLMStreamParams, callbacks: LLMCallbacks): Promise<void> {
    await this.delay();

    if (this.config.errorToThrow) {
      callbacks.onError?.(this.config.errorToThrow);
      return;
    }

    // Simulate streaming by sending content in chunks
    if (this.config.streamResponses && this.config.responseText.length > 0) {
      callbacks.onStart?.();

      const content = this.config.responseText;
      const chunkSize = Math.max(1, Math.floor(content.length / 3));

      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, i + chunkSize);
        callbacks.onContent?.(chunk, false);
      }

      // Send tool calls if configured
      for (const toolCall of this.config.toolCalls) {
        callbacks.onToolCall?.(
          toolCall.function.name,
          JSON.parse(toolCall.function.arguments),
          toolCall.id,
        );
      }

      callbacks.onUsage?.(this.config.usage);
      callbacks.onComplete?.(this.config.usage);
    } else {
      // Single response without streaming
      callbacks.onStart?.();
      callbacks.onContent?.(this.config.responseText, false);
      callbacks.onComplete?.(this.config.usage);
    }
  }

  /**
   * Helper to simulate network delay.
   */
  private async delay(): Promise<void> {
    if (this.config.responseDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.responseDelayMs));
    }
  }
}

/**
 * Creates a mock adapter that simulates an LLM with reasoning.
 */
export function createReasoningMockAdapter(config?: {
  reasoningText?: string;
  responseText?: string;
}): LLMAdapter {
  return new ReasoningMockAdapter({
    reasoningText: config?.reasoningText ?? "Let me think about this...",
    responseText: config?.responseText ?? "Here's my answer.",
  });
}

/**
 * Mock adapter that simulates reasoning content.
 */
class ReasoningMockAdapter implements LLMAdapter {
  readonly name: LLMProviderType = "mock-reasoning";
  readonly displayName = "Mock Reasoning LLM";

  private reasoningText: string;
  private responseText: string;

  constructor(config: { reasoningText: string; responseText: string }) {
    this.reasoningText = config.reasoningText;
    this.responseText = config.responseText;
  }

  isConfigured(): boolean {
    return true;
  }

  getDefaultModel(): string {
    return "mock-reasoning-model";
  }

  async listModels(): Promise<string[]> {
    return ["mock-reasoning-model"];
  }

  async complete(params: LLMCompleteParams): Promise<LLMResponse> {
    return {
      success: true,
      content: `${this.reasoningText}\n\n${this.responseText}`,
    };
  }

  async stream(params: LLMStreamParams, callbacks: LLMCallbacks): Promise<void> {
    callbacks.onStart?.();
    callbacks.onReasoningStart?.();

    // Stream reasoning
    const reasoningChunks = this.reasoningText.split(" ");
    for (const chunk of reasoningChunks) {
      callbacks.onReasoningDelta?.(chunk + " ");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    callbacks.onReasoningEnd?.();

    // Stream response
    const responseChunks = this.responseText.split(" ");
    for (const chunk of responseChunks) {
      callbacks.onContent?.(chunk + " ", false);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    callbacks.onComplete?.({ inputTokens: 10, outputTokens: 20 });
  }
}

/**
 * Creates a mock adapter that always fails with a specific error.
 */
export function createFailingMockAdapter(errorMessage: string, retryable = false): LLMAdapter {
  return new FailingMockAdapter(errorMessage, retryable);
}

/**
 * Mock adapter that always throws errors.
 */
class FailingMockAdapter implements LLMAdapter {
  readonly name: LLMProviderType = "mock-failing";
  readonly displayName = "Mock Failing LLM";

  constructor(
    private errorMessage: string,
    private retryable: boolean,
  ) {}

  isConfigured(): boolean {
    return true;
  }

  getDefaultModel(): string {
    return "mock-failing-model";
  }

  async listModels(): Promise<string[]> {
    return [];
  }

  async complete(): Promise<LLMResponse> {
    return {
      success: false,
      message: this.errorMessage,
      retryable: this.retryable,
    };
  }

  async stream(_params: LLMStreamParams, callbacks: LLMCallbacks): Promise<void> {
    callbacks.onError?.(new Error(this.errorMessage));
  }
}

/**
 * Creates a mock adapter that simulates rate limiting.
 */
export function createRateLimitedMockAdapter(attemptsBeforeSuccess: number = 3): LLMAdapter {
  return new RateLimitedMockAdapter(attemptsBeforeSuccess);
}

/**
 * Mock adapter that simulates rate limiting with eventual success.
 */
class RateLimitedMockAdapter implements LLMAdapter {
  readonly name: LLMProviderType = "mock-rate-limited";
  readonly displayName = "Mock Rate-Limited LLM";

  private attempts = 0;
  private readonly attemptsBeforeSuccess: number;

  constructor(attemptsBeforeSuccess: number) {
    this.attemptsBeforeSuccess = attemptsBeforeSuccess;
  }

  isConfigured(): boolean {
    return true;
  }

  getDefaultModel(): string {
    return "mock-rate-limited-model";
  }

  async listModels(): Promise<string[]> {
    return ["mock-rate-limited-model"];
  }

  async complete(params: LLMCompleteParams): Promise<LLMResponse> {
    this.attempts++;

    if (this.attempts < this.attemptsBeforeSuccess) {
      return {
        success: false,
        message: "Rate limit exceeded. Please retry.",
        retryable: true,
      };
    }

    return {
      success: true,
      content: "Success after rate limit retries!",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
  }

  async stream(params: LLMStreamParams, callbacks: LLMCallbacks): Promise<void> {
    this.attempts++;

    if (this.attempts < this.attemptsBeforeSuccess) {
      callbacks.onError?.(new Error("Rate limit exceeded"));
      return;
    }

    callbacks.onStart?.();
    callbacks.onContent?.("Success after rate limit retries!", false);
    callbacks.onComplete?.();
  }
}

/**
 * Mock adapter factory for common test scenarios.
 */
export const MockAdapters = {
  /** Returns a simple text response adapter. */
  simple(text: string = "Mock response"): LLMAdapter {
    return createMockAdapter({ responseText: text });
  },

  /** Returns an adapter with tool calls. */
  withToolCalls(toolCalls: LLMToolCall[], responseText?: string): LLMAdapter {
    return createMockAdapter({ responseText, toolCalls });
  },

  /** Returns an adapter that simulates reasoning. */
  withReasoning(reasoning: string, response: string): LLMAdapter {
    return createReasoningMockAdapter({ reasoningText: reasoning, responseText: response });
  },

  /** Returns an adapter that always fails. */
  failing(error: string, retryable = false): LLMAdapter {
    return createFailingMockAdapter(error, retryable);
  },

  /** Returns an adapter that rate limits then succeeds. */
  rateLimited(attempts = 3): LLMAdapter {
    return createRateLimitedMockAdapter(attempts);
  },

  /** Returns an adapter with configurable delay. */
  delayed(delayMs: number, text?: string): LLMAdapter {
    return createMockAdapter({ responseDelayMs: delayMs, responseText: text });
  },
};
