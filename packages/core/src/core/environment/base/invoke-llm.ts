/**
 * @fileoverview LLM invocation with AI SDK integration.
 *
 * This module provides LLM invocation using AI SDK for better provider support.
 * Maintains backward compatibility with existing StreamEventHandler interface.
 */

import { streamText, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolInfo, ToolResult, ToolContext } from "../../types/index.js";
import { createLogger } from "../../../utils/logger.js";
import { providerManager } from "../../../llm/provider-manager.js";
import { LLMTransform } from "../../../llm/transform.js";

const invokeLLMLogger = createLogger("invoke:llm", "server.log");

export interface InvokeLLMConfig {
  model: string;
  baseURL: string;
  apiKey: string;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Record<string, unknown>;
  name?: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export interface LLMOptions {
  messages: LLMMessage[];
  tools?: ToolInfo[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface LLMOutput extends Record<string, unknown> {
  content: string;
  reasoning?: string;
  tool_calls?: Array<{
    id: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  model: string;
}

export interface StreamEventHandler {
  onStart?: (metadata: { model: string }) => void;
  onText?: (content: string, delta: string) => void;
  onReasoning?: (content: string) => void;
  onToolCall?: (toolName: string, toolArgs: Record<string, unknown>, toolCallId: string) => void;
  onCompleted?: (content: string, metadata: { model: string }) => void;
}

/**
 * Parse model string in format "providerId/modelId"
 */
function parseModelString(model?: string): { providerId: string; modelId: string } {
  if (!model) {
    // Use default from providers.jsonc
    const providers = providerManager.listProviders();
    if (providers.length === 0) {
      throw new Error("No providers available. Please check providers.jsonc configuration.");
    }
    const defaultProvider = providers[0];
    return { 
      providerId: defaultProvider.id, 
      modelId: defaultProvider.defaultModel 
    };
  }

  const parts = model.split("/");
  if (parts.length === 2) {
    return { providerId: parts[0], modelId: parts[1] };
  }

  // If only modelId provided, try to find in providers
  const providers = providerManager.listProviders();
  for (const provider of providers) {
    if (provider.models.some(m => m.id === model)) {
      return { providerId: provider.id, modelId: model };
    }
  }

  throw new Error(`Invalid model format: ${model}. Expected: providerId/modelId or model must exist in providers.jsonc`);
}

/**
 * Convert internal LLMMessage to AI SDK ModelMessage format
 */
function convertToSDKMessages(messages: LLMMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    const sdkMsg: any = {
      role: msg.role,
      content: msg.content,
    };

    if (msg.name) {
      sdkMsg.name = msg.name;
    }

    if (msg.tool_call_id) {
      sdkMsg.toolCallId = msg.tool_call_id;
    }

    if (msg.tool_calls && msg.role === "assistant") {
      // Convert tool_calls to AI SDK format
      sdkMsg.content = [
        ...(typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : []),
        ...msg.tool_calls.map((tc) => ({
          type: "tool-call",
          toolCallId: tc.id,
          toolName: tc.function.name,
          args: JSON.parse(tc.function.arguments || "{}"),
        })),
      ];
    }

    return sdkMsg;
  }) as ModelMessage[];
}

/**
 * Convert ToolInfo to AI SDK ToolSet format
 */
function convertToolsToSDK(tools: ToolInfo[]): ToolSet {
  const result: ToolSet = {};
  
  for (const tool of tools) {
    // Use type assertion to avoid strict type checking issues
    (result as any)[tool.name] = {
      description: tool.description || "",
      parameters: extractToolSchema(tool.parameters),
    };
  }
  
  invokeLLMLogger.debug("[convertToolsToSDK] Converted tools", { 
    input: tools.map(t => t.name), 
    output: Object.keys(result) 
  });
  
  return result;
}

/**
 * Extract JSON schema from Zod type
 */
function extractToolSchema(parameters: z.ZodType): Record<string, unknown> {
  const schema = zodToJsonSchema(parameters, "zod");
  if ("$ref" in schema && schema.definitions) {
    const def = (schema.definitions as Record<string, unknown>).zod as Record<string, unknown> | undefined;
    if (def && def.type === "object" && def.properties) {
      return {
        type: "object",
        properties: def.properties,
        required: def.required,
        additionalProperties: true,
      };
    }
  }
  return schema as Record<string, unknown>;
}

/**
 * Core LLM invocation using AI SDK
 */
export async function invokeLLM(
  config: InvokeLLMConfig,
  options: LLMOptions,
  ctx: ToolContext,
  eventHandler?: StreamEventHandler
): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    // 1. Parse model string to get provider and model
    const { providerId, modelId } = parseModelString(options.model || config.model);
    
    invokeLLMLogger.info("[invokeLLM] Starting with AI SDK", { 
      providerId, 
      modelId,
      messageCount: options.messages.length,
      toolCount: options.tools?.length || 0 
    });

    // 2. Get provider instance
    const provider = providerManager.getProvider(providerId);
    if (!provider) {
      throw new Error(`Provider ${providerId} not found. Please check providers.jsonc configuration.`);
    }

    // 3. Get model metadata
    const modelMetadata = provider.metadata.models.find(m => m.id === modelId);
    if (!modelMetadata) {
      invokeLLMLogger.warn(`[invokeLLM] Model ${modelId} not found in provider metadata, using defaults`);
    }

    // 4. Convert messages to AI SDK format
    let messages = convertToSDKMessages(options.messages);
    
    // 5. Apply provider-specific transformations
    messages = LLMTransform.normalizeMessages(
      messages, 
      provider.metadata, 
      modelMetadata || provider.metadata.models[0] || { id: modelId, capabilities: { temperature: true, reasoning: false, toolcall: true, attachment: false, input: { text: true, image: false, audio: false, video: false, pdf: false }, output: { text: true, image: false, audio: false } }, limits: { contextWindow: 8192 } }
    );

    // 6. Apply caching for supported providers
    if (provider.metadata.sdkType === "anthropic") {
      messages = LLMTransform.applyCaching(messages, provider.metadata);
    }

    // 7. Generate provider-specific options
    const providerOptions = LLMTransform.generateProviderOptions(
      provider.metadata,
      modelMetadata || provider.metadata.models[0] || { id: modelId, capabilities: { temperature: true, reasoning: false, toolcall: true, attachment: false, input: { text: true, image: false, audio: false, video: false, pdf: false }, output: { text: true, image: false, audio: false } }, limits: { contextWindow: 8192 } },
      {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      }
    );

    // 8. Convert tools
    const tools = options.tools && options.tools.length > 0 
      ? convertToolsToSDK(options.tools) 
      : undefined;

    // 9. Emit start event
    if (eventHandler?.onStart) {
      eventHandler.onStart({ model: `${providerId}/${modelId}` });
    }

    // 10. Call AI SDK streamText
    const result = await streamText({
      model: provider.sdk.languageModel(modelId),
      messages,
      tools,
      temperature: providerOptions.temperature,
      maxTokens: providerOptions.maxTokens,
      ...providerOptions.providerOptions,
      abortSignal: ctx.abort,
      maxRetries: 2,
    });

    // 11. Process stream
    let fullContent = "";
    let reasoningContent = "";
    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];

    invokeLLMLogger.info("[invokeLLM] Starting to process stream");

    for await (const part of result.fullStream) {
      const streamPart = part as any;
      switch (streamPart.type) {
        case "text-delta":
          const textDelta = streamPart.text as string;
          fullContent += textDelta;
          invokeLLMLogger.debug("[invokeLLM] Text delta received", { length: textDelta.length });
          if (eventHandler?.onText) {
            eventHandler.onText(fullContent, textDelta);
          }
          break;

        case "reasoning-delta":
          const reasoningDelta = streamPart.text as string;
          reasoningContent += reasoningDelta;
          invokeLLMLogger.debug("[invokeLLM] Reasoning received", { length: reasoningDelta.length });
          if (eventHandler?.onReasoning) {
            eventHandler.onReasoning(reasoningContent);
          }
          break;

        case "tool-call":
          const toolInput = streamPart.input as Record<string, unknown>;
          toolCalls.push({
            id: streamPart.toolCallId,
            name: streamPart.toolName,
            args: toolInput,
          });
          invokeLLMLogger.info("[invokeLLM] Tool call received", { 
            toolName: streamPart.toolName, 
            toolCallId: streamPart.toolCallId 
          });
          if (eventHandler?.onToolCall) {
            eventHandler.onToolCall(streamPart.toolName, toolInput, streamPart.toolCallId);
          }
          break;

        case "error":
          throw streamPart.error;

        case "finish":
          invokeLLMLogger.info("[invokeLLM] Stream finished", { 
            finishReason: streamPart.finishReason,
            usage: streamPart.totalUsage 
          });
          break;
      }
    }

    // 12. Build output
    const output: LLMOutput = {
      content: fullContent,
      reasoning: reasoningContent || undefined,
      model: `${providerId}/${modelId}`,
    };

    if (toolCalls.length > 0) {
      output.tool_calls = toolCalls.map(tc => ({
        id: tc.id,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.args),
        },
      }));
      invokeLLMLogger.info("[invokeLLM] Returning with tool_calls", { count: toolCalls.length });
    } else {
      // Emit completed event only when no tool calls
      if (eventHandler?.onCompleted) {
        eventHandler.onCompleted(fullContent, { model: `${providerId}/${modelId}` });
      }
      invokeLLMLogger.info("[invokeLLM] Returning content (no tool_calls)");
    }

    return {
      success: true,
      output,
      metadata: {
        execution_time_ms: Date.now() - startTime,
        provider: providerId,
        model: modelId,
      },
    };

  } catch (error) {
    invokeLLMLogger.error("[invokeLLM] Error during invocation:", error);
    return {
      success: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        execution_time_ms: Date.now() - startTime,
      },
    };
  }
}

/**
 * Simple non-streaming LLM call for intuitive reasoning
 */
export async function intuitiveReasoning(
  config: InvokeLLMConfig,
  options: Omit<LLMOptions, "tools" | "stream">,
  ctx: ToolContext
): Promise<ToolResult> {
  return invokeLLM(
    config,
    { ...options, stream: true },  // AI SDK always streams, we just don't emit events
    ctx
  );
}

/**
 * Legacy: Create LLM config from environment
 * Note: This is now handled by ProviderManager, kept for backward compatibility
 */
export function createLLMConfigFromEnv(model: string): InvokeLLMConfig | undefined {
  const parts = model.split("/");
  const provider = parts[0] || "openai";
  const modelId = parts.slice(1).join("/") || "gpt-4o";

  const apiKey = process.env.LLM_API_KEY || process.env[`${provider.toUpperCase()}_API_KEY`];
  if (!apiKey) return undefined;

  const baseURL = process.env.LLM_BASE_URL || process.env[`${provider.toUpperCase()}_BASE_URL`];

  return {
    model: modelId,
    baseURL: baseURL || "",
    apiKey,
  };
}

/**
 * Legacy: Create LLM config from explicit parameters
 * Note: This is now handled by ProviderManager, kept for backward compatibility
 */
export function createLLMConfig(
  model: string,
  baseURL: string,
  apiKey: string
): InvokeLLMConfig {
  const parts = model.split("/");
  const modelId = parts.slice(1).join("/") || model;

  return {
    model: modelId,
    baseURL: baseURL || "",
    apiKey,
  };
}

// Legacy tool creators - kept for backward compatibility
export function createInvokeLLM(config: InvokeLLMConfig): ToolInfo {
  return {
    name: "invoke_llm",
    description: "Direct LLM API call. Use this for simple text generation tasks only. DO NOT use this tool for complex tasks that might require other tools - let the main agent handle those. This tool does NOT support recursive tool calling.",
    parameters: z.object({
      messages: z
        .array(
          z.object({
            role: z.enum(["system", "user", "assistant", "tool"]),
            content: z.string(),
            name: z.string().optional(),
          }),
        )
        .min(1)
        .describe("Conversation history with roles and content"),
      tools: z
        .array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            parameters: z.record(z.string(), z.any()),
          }),
        )
        .optional()
        .describe("Available tools"),
      model: z.string().optional().describe("Model identifier"),
      temperature: z.number().min(0).max(2).optional().describe("Temperature (0-2)"),
      maxTokens: z.number().positive().optional().describe("Maximum output tokens"),
    }),
    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const { invokeLLM } = await import("./invoke-llm.js");
      return invokeLLM(
        config,
        {
          messages: args.messages as LLMMessage[],
          tools: args.tools as ToolInfo[] | undefined,
          model: args.model as string | undefined,
          temperature: args.temperature as number | undefined,
          maxTokens: args.maxTokens as number | undefined,
          stream: true,
        },
        ctx,
        {
          onStart: (metadata) => {
            const env = (ctx as any).env;
            if (env?.emitStreamEvent) {
              env.emitStreamEvent({ type: "start", metadata }, { 
                session_id: ctx.session_id || "default",
                message_id: (ctx.metadata as any)?.message_id 
              });
            }
          },
          onText: (content, delta) => {
            const env = (ctx as any).env;
            if (env?.emitStreamEvent) {
              env.emitStreamEvent({ type: "text", content, delta }, { 
                session_id: ctx.session_id || "default",
                message_id: (ctx.metadata as any)?.message_id 
              });
            }
          },
          onReasoning: (content) => {
            const env = (ctx as any).env;
            if (env?.emitStreamEvent) {
              env.emitStreamEvent({ type: "reasoning", content }, { 
                session_id: ctx.session_id || "default",
                message_id: (ctx.metadata as any)?.message_id 
              });
            }
          },
          onToolCall: (toolName, toolArgs, toolCallId) => {
            const env = (ctx as any).env;
            if (env?.emitStreamEvent) {
              env.emitStreamEvent({ 
                type: "tool_call", 
                tool_name: toolName, 
                tool_args: toolArgs, 
                tool_call_id: toolCallId 
              }, { 
                session_id: ctx.session_id || "default",
                message_id: (ctx.metadata as any)?.message_id 
              });
            }
          },
          onCompleted: (content, metadata) => {
            const env = (ctx as any).env;
            if (env?.emitStreamEvent) {
              env.emitStreamEvent({ type: "completed", content, metadata }, { 
                session_id: ctx.session_id || "default",
                message_id: (ctx.metadata as any)?.message_id 
              });
            }
          },
        }
      );
    },
  };
}

export function createSystem1IntuitiveReasoning(config: InvokeLLMConfig): ToolInfo {
  return {
    name: "system1_intuitive_reasoning",
    description: "Direct LLM call for simple tasks (Q&A, text generation, translation, summarization).",
    parameters: z.object({
      messages: z
        .array(
          z.object({
            role: z.enum(["system", "user", "assistant", "tool"]),
            content: z.string(),
            name: z.string().optional(),
          }),
        )
        .min(1)
        .describe("Conversation history"),
      model: z.string().optional().describe("Model identifier"),
      temperature: z.number().min(0).max(2).optional().describe("Temperature (0-2)"),
      maxTokens: z.number().positive().optional().describe("Maximum output tokens"),
    }),
    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const { intuitiveReasoning } = await import("./invoke-llm.js");
      return intuitiveReasoning(
        config,
        {
          messages: args.messages as LLMMessage[],
          model: args.model as string | undefined,
          temperature: args.temperature as number | undefined,
          maxTokens: args.maxTokens as number | undefined,
        },
        ctx
      );
    },
  };
}
