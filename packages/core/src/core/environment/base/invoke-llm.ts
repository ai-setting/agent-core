/**
 * @fileoverview LLM invocation with AI SDK integration.
 *
 * This module provides LLM invocation using AI SDK for better provider support.
 * Maintains backward compatibility with existing StreamEventHandler interface.
 */

import { streamText, type ModelMessage, type ToolSet, jsonSchema } from "ai";
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

// Note: ModelMessage interface removed. Use ModelMessage from 'ai' SDK directly.

export interface LLMOptions {
  messages: ModelMessage[];
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

/**
 * Usage information from LLM API
 */
export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Some providers (like MiniMax) return token details in this format */
  inputTokenDetails?: {
    tokens?: number;
    [key: string]: unknown;
  };
  outputTokenDetails?: {
    tokens?: number;
    [key: string]: unknown;
  };
  /** MiniMax returns only total_tokens in streaming response */
  raw?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

/**
 * Extract usage info from AI SDK response
 * Handles different provider formats (some use inputTokens directly, some use inputTokenDetails)
 */
function extractUsageInfo(usage: UsageInfo | undefined): UsageInfo | undefined {
  if (!usage) return undefined;
  
  // Standard format: direct properties
  if (typeof usage.inputTokens === 'number') {
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    };
  }
  
  // MiniMax format: using tokenDetails
  if (usage.inputTokenDetails || usage.outputTokenDetails) {
    return {
      inputTokens: usage.inputTokenDetails?.tokens ?? 0,
      outputTokens: usage.outputTokenDetails?.tokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
    };
  }

  // MiniMax streaming format: only has total_tokens in raw
  if (usage.raw && typeof usage.raw.total_tokens === 'number') {
    // For streaming, total_tokens is the only info available
    // We can't split input/output, so set both to 0 or estimate
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: usage.raw.total_tokens,
    };
  }
  
  return undefined;
}

export interface StreamEventHandler {
  onStart?: (metadata: { model: string }) => void;
  onText?: (content: string, delta: string) => void;
  onReasoning?: (content: string) => void;
  onToolCall?: (toolName: string, toolArgs: Record<string, unknown>, toolCallId: string) => void;
  onCompleted?: (content: string, metadata: { 
    model: string;
    usage?: UsageInfo;
  }) => void;
}

/**
 * Parse model string in format "providerId/modelId"
 */
export function parseModelString(model?: string): { providerId: string; modelId: string } {
  invokeLLMLogger.info("[parseModelString] Starting to parse model", { model });
  
  if (!model) {
    // Use default from providers.jsonc
    const providers = providerManager.listProviders();
    invokeLLMLogger.info("[parseModelString] No model provided, using default", { 
      availableProviders: providers.length 
    });
    
    if (providers.length === 0) {
      throw new Error("No providers available. Please check providers.jsonc configuration.");
    }
    const defaultProvider = providers[0];
    invokeLLMLogger.info("[parseModelString] Using default provider", { 
      providerId: defaultProvider.id, 
      modelId: defaultProvider.defaultModel 
    });
    return { 
      providerId: defaultProvider.id, 
      modelId: defaultProvider.defaultModel 
    };
  }

  const parts = model.split("/");
  if (parts.length === 2) {
    invokeLLMLogger.info("[parseModelString] Parsed provider/model format", { 
      providerId: parts[0], 
      modelId: parts[1] 
    });
    return { providerId: parts[0], modelId: parts[1] };
  }

  // If only modelId provided, try to find in providers
  const providers = providerManager.listProviders();
  invokeLLMLogger.info("[parseModelString] Looking for model in providers", { 
    model,
    availableProviders: providers.map(p => ({ 
      id: p.id, 
      models: p.models.map(m => m.id) 
    }))
  });
  
  for (const provider of providers) {
    if (provider.models.some(m => m.id === model)) {
      invokeLLMLogger.info("[parseModelString] Found model in provider", { 
        providerId: provider.id, 
        modelId: model 
      });
      return { providerId: provider.id, modelId: model };
    }
  }

  invokeLLMLogger.error("[parseModelString] Model not found in any provider", { 
    model,
    availableProviders: providers.map(p => p.id)
  });
  throw new Error(`Invalid model format: ${model}. Expected: providerId/modelId or model must exist in providers.jsonc`);
}

/**
 * Convert messages to ensure AI SDK compatibility
 * Since we now use ModelMessage format throughout, this mainly validates and logs
 */
function convertToSDKMessages(messages: ModelMessage[]): ModelMessage[] {
  // Processing messages // 已精简
  
  // Messages should already be in ModelMessage format from session history
  // Just return them as-is, but log any potential issues
  return messages.map((msg) => {
    // Validate that tool messages have proper format
    if (msg.role === "tool") {
      const toolMsg = msg as any;
      if (!toolMsg.toolCallId && !toolMsg.tool_call_id) {
        invokeLLMLogger.warn("[convertToSDKMessages] Tool message missing toolCallId", { msg });
      }
    }
    
    return msg;
  });
}

/**
 * Convert ToolInfo to AI SDK ToolSet format
 */
function convertToolsToSDK(tools: ToolInfo[]): ToolSet {
  const result: ToolSet = {};
  
  for (const tool of tools) {
    const jsonSchemaObj = extractToolSchema(tool.parameters);
    (result as any)[tool.name] = {
      description: tool.description || "",
      inputSchema: jsonSchema(jsonSchemaObj),
    };
  }
  
  // Converted tools debug // 已精简

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
    
    // Messages converted debug // 已精简
    
    
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
    const modelForOptions = modelMetadata || provider.metadata.models[0] || { id: modelId, capabilities: { temperature: true, reasoning: false, toolcall: true, attachment: false, input: { text: true, image: false, audio: false, video: false, pdf: false }, output: { text: true, image: false, audio: false } }, limits: { contextWindow: 8192 } };
    
    invokeLLMLogger.info("[invokeLLM] Generating provider options", {
      providerId: provider.metadata.id,
      modelId: modelForOptions.id,
      modelCapabilities: modelForOptions.capabilities,
      optionsTemperature: options.temperature,
    });
    
    const providerOptions = LLMTransform.generateProviderOptions(
      provider.metadata,
      modelForOptions,
      {
        temperature: options.temperature,
        maxTokens: options.maxTokens,
      }
    );

    invokeLLMLogger.info("[invokeLLM] Provider options generated", {
      providerOptions,
      hasTemperature: providerOptions.temperature !== undefined,
      temperatureValue: providerOptions.temperature,
    });

    // 8. Convert tools
    const tools = options.tools && options.tools.length > 0 
      ? convertToolsToSDK(options.tools) 
      : undefined;

    // 9. Emit start event
    if (eventHandler?.onStart) {
      eventHandler.onStart({ model: `${providerId}/${modelId}` });
    }

    // 10. Call AI SDK streamText
    invokeLLMLogger.info("[invokeLLM] About to call streamText", { 
      modelId, 
      messageCount: messages.length,
      toolsCount: tools ? Object.keys(tools).length : 0
    });
    
    let result;
    try {
    const streamTextOptions = {
      model: provider.sdk.languageModel(modelId),
      messages,
      tools,
      temperature: providerOptions.temperature,
      maxTokens: providerOptions.maxTokens,
      // Pass includeUsage at top level for openai-compatible providers
      includeUsage: providerOptions.includeUsage,
      ...providerOptions.providerOptions,
      abortSignal: ctx.abort,
      maxRetries: 2,
      // Enable usage info in stream completion
      streamOptions: {
        includeUsage: true,
      },
      };
     
    invokeLLMLogger.info("[invokeLLM] Calling streamText", {
      modelId,
      providerId: provider.metadata.id,
      hasTools: !!tools,
    });
      
      result = await streamText(streamTextOptions);
      invokeLLMLogger.info("[invokeLLM] streamText completed");
    } catch (streamError) {
      invokeLLMLogger.error("[invokeLLM] streamText failed", { 
        error: streamError instanceof Error ? streamError.message : String(streamError),
        stack: streamError instanceof Error ? streamError.stack : undefined,
        providerOptions,
        modelId,
        providerId: provider.metadata.id,
      });
      throw streamError;
    }

    // 11. Process stream
    let fullContent = "";
    let reasoningContent = "";
    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = [];
    let usageInfo: UsageInfo | undefined;
    
    // State for streaming reasoning from text delta
    let isThinkingTagOpen = false;
    let currentThinkingContent = "";

    invokeLLMLogger.info("[invokeLLM] Starting to process stream");

    for await (const part of result.fullStream) {
      const streamPart = part as any;
      switch (streamPart.type) {
        case "text-delta":
          const textDelta = streamPart.text as string;
          
          // Check if model has thinkingInText configuration
          const thinkingConfig = modelMetadata?.capabilities?.thinkingInText;
          
          if (thinkingConfig?.enabled) {
            // Process thinking tags for streaming reasoning
            const thinkingResult = processThinkingStream(
              textDelta,
              thinkingConfig,
              {
                isOpen: isThinkingTagOpen,
                content: currentThinkingContent
              }
            );
            
            // Update state
            isThinkingTagOpen = thinkingResult.isThinkingTagOpen;
            currentThinkingContent = thinkingResult.currentThinkingContent;
            
            // Update fullContent with cleaned text (without thinking tags)
            fullContent += thinkingResult.cleanedText;
            
            // Trigger reasoning events for each streaming update
            // This ensures reasoning is emitted immediately when:
            // 1. Opening tag is detected
            // 2. Thinking content changes (streaming)
            // 3. Closing tag is detected
            for (const reasoningDelta of thinkingResult.reasoningEvents) {
              reasoningContent = reasoningDelta;  // Replace with latest
              if (eventHandler?.onReasoning) {
                eventHandler.onReasoning(reasoningContent);
              }
            }
            
            // Also trigger text event with cleaned content
            if (eventHandler?.onText) {
              eventHandler.onText(fullContent, thinkingResult.cleanedText);
            }
          } else {
            // Original handling
            fullContent += textDelta;
            if (eventHandler?.onText) {
              eventHandler.onText(fullContent, textDelta);
            }
          }
          break;

        case "reasoning-delta":
          const reasoningDelta = streamPart.text as string;
          reasoningContent += reasoningDelta;
          // Reasoning debug // 已精简
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
          // 截断过长参数，保留前 300 字符
          const toolArgsStr = JSON.stringify(toolInput);
          const truncatedToolArgs = toolArgsStr.length > 300 
            ? toolArgsStr.substring(0, 300) + "...[truncated]" 
            : toolArgsStr;
          invokeLLMLogger.info("[invokeLLM] Tool call received", { 
            toolName: streamPart.toolName, 
            toolCallId: streamPart.toolCallId,
            toolArgs: truncatedToolArgs
          });
          if (eventHandler?.onToolCall) {
            eventHandler.onToolCall(streamPart.toolName, toolInput, streamPart.toolCallId);
          }
          break;

        case "finish-step":
          // Capture usage from finish-step event (more reliable for some providers like MiniMax)
          const stepUsage = extractUsageInfo(streamPart.usage);
          if (stepUsage) {
            usageInfo = stepUsage;
          }
          break;

        case "error":
          throw streamPart.error;

        case "finish":
          // Capture usage info from stream completion
          // Use extractUsageInfo to handle different provider formats (MiniMax uses tokenDetails)
          usageInfo = extractUsageInfo(streamPart.totalUsage);
          if (!usageInfo && streamPart.usage) {
            usageInfo = extractUsageInfo(streamPart.usage);
          }
          break;
      }
    }

    // 12. Build output
    const output: LLMOutput = {
      content: fullContent,
      reasoning: reasoningContent || undefined,
      model: `${providerId}/${modelId}`,
    };

    // Emit completed event with usage info (for both tool calls and non-tool calls cases)
    if (eventHandler?.onCompleted) {
      await eventHandler.onCompleted(fullContent, { 
        model: `${providerId}/${modelId}`,
        usage: usageInfo
      });
    }

    if (toolCalls.length > 0) {
      output.tool_calls = toolCalls.map(tc => ({
        id: tc.id,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.args),
        },
      }));
      // 截断工具调用参数，保留前 300 字符
      const toolCallsStr = JSON.stringify(toolCalls);
      const truncatedToolCalls = toolCallsStr.length > 300 
        ? toolCallsStr.substring(0, 300) + "...[truncated]" 
        : toolCallsStr;
      invokeLLMLogger.info("[invokeLLM] Returning with tool_calls", { 
        count: toolCalls.length,
        toolCalls: truncatedToolCalls,
        usage: usageInfo
      });
    } else {
      // 截断过长响应内容，保留前 300 字符
      const truncatedContent = fullContent.length > 300 
        ? fullContent.substring(0, 300) + "...[truncated]" 
        : fullContent;
      invokeLLMLogger.info("[invokeLLM] Returning content (no tool_calls)", { 
        contentLength: fullContent.length,
        content: truncatedContent,
        usage: usageInfo
      });
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
    // Use the model that was actually used for the call (options.model or config.model)
    const modelForErrorLog = options.model || config.model;
    const errorProviderInfo = (() => { 
      try { 
        return parseModelString(modelForErrorLog); 
      } catch { 
        return { providerId: 'unknown', modelId: 'unknown' }; 
      } 
    })();
    
    invokeLLMLogger.error("[invokeLLM] Error during invocation", { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      providerId: errorProviderInfo.providerId,
      modelId: errorProviderInfo.modelId,
      messageCount: options.messages.length
    });
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
  // Store the full model format (providerId/modelId) to preserve provider information
  // This ensures parseModelString can correctly identify the provider later
  return {
    model: model, // Keep full format like "kimi/kimi-k2.5"
    baseURL: baseURL || "",
    apiKey,
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
          messages: args.messages as ModelMessage[],
          model: args.model as string | undefined,
          temperature: args.temperature as number | undefined,
          maxTokens: args.maxTokens as number | undefined,
        },
        ctx
      );
    },
  };
}

/**
 * Process thinking tags from text delta
 * Extracts thinking content from text and triggers reasoning events
 * Used for models like MiniMax 2.5 that put thinking in text delta
 * 
 * @param textDelta - The incoming text delta
 * @param config - thinkingInText configuration
 * @returns Cleaned text and extracted thinking content
 */
function processThinkingFromText(
  textDelta: string,
  config: {
    enabled?: boolean;
    tags?: string[];
    removeFromOutput?: boolean;
  }
): { cleanedText: string; thinkingContent?: string } {
  if (!config.enabled || !textDelta) {
    return { cleanedText: textDelta };
  }

  const tags = config.tags || ['thinking'];
  let remainingText = textDelta;
  let extractedThinking = '';

  for (const tag of tags) {
    // Handle two cases:
    // 1. Normal tag: "thinking" -> generates <thinking> and </thinking>
    // 2. Special case: "think" -> maps to <think>/</think> (for minimax compatibility)
    let openTag: string;
    let closeTag: string;
    
    // Special handling for "think" -> maps to standard <think>/</think>
    if (tag === 'think') {
      openTag = '<think>';
      closeTag = '</think>';
    } else {
      openTag = `<${tag}>`;
      closeTag = `</${tag}>`;
    }
    
    // Match all thinking tags (case-insensitive, global)
    const regex = new RegExp(`${openTag}([\\s\\S]*?)${closeTag}`, 'gi');
    let match;
    
    while ((match = regex.exec(remainingText)) !== null) {
      // Extract content inside tags
      const content = match[1];
      extractedThinking += content;
      
      // Remove thinking tags from output if configured (use replaceAll for all matches)
      if (config.removeFromOutput !== false) {
        remainingText = remainingText.replaceAll(match[0], '');
      }
    }
  }

  return {
    cleanedText: remainingText,
    thinkingContent: extractedThinking || undefined
  };
}

/**
 * Process thinking tags from text delta with streaming support
 * Emits reasoning events IMMEDIATELY when:
 * 1. Opening tag is detected (starts reasoning)
 * 2. Thinking content changes (streaming content)
 * 3. Closing tag is detected (ends reasoning)
 */
function processThinkingStream(
  textDelta: string,
  config: {
    enabled?: boolean;
    tags?: string[];
    removeFromOutput?: boolean;
  },
  state: {
    isOpen: boolean;
    content: string;
  }
): {
  cleanedText: string;
  isThinkingTagOpen: boolean;
  currentThinkingContent: string;
  reasoningEvents: string[];
} {
  if (!config.enabled || !textDelta) {
    return {
      cleanedText: textDelta,
      isThinkingTagOpen: state.isOpen,
      currentThinkingContent: state.content,
      reasoningEvents: []
    };
  }

  const tags = config.tags || ['thinking'];
  let remainingText = textDelta;
  let reasoningEvents: string[] = [];
  let isOpen = state.isOpen;
  let currentContent = state.content;

  for (const tag of tags) {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    
    let text = remainingText;
    let result = "";
    
    // Check if we have an opening tag in current text
    const openIndex = text.toLowerCase().indexOf(openTag.toLowerCase());
    const closeIndex = text.toLowerCase().indexOf(closeTag.toLowerCase());
    
    if (openIndex !== -1 && (closeIndex === -1 || openIndex < closeIndex)) {
      // Opening tag found first
      const beforeOpen = text.substring(0, openIndex);
      const afterOpen = text.substring(openIndex + openTag.length);
      
      if (!isOpen) {
        // First time seeing opening tag - start new thinking block
        isOpen = true;
        currentContent = "";
        // Emit event to start reasoning
        reasoningEvents.push("");
      }
      
      // Add text before opening tag to cleaned output
      result += beforeOpen;
      
      // Check if there's also a closing tag in this delta
      const innerCloseIndex = afterOpen.toLowerCase().indexOf(closeTag.toLowerCase());
      
      if (innerCloseIndex !== -1) {
        // Both open and close in same delta
        const thinkingContent = afterOpen.substring(0, innerCloseIndex);
        const afterClose = afterOpen.substring(innerCloseIndex + closeTag.length);
        
        // Add thinking content
        currentContent += thinkingContent;
        // Emit streaming reasoning event
        reasoningEvents.push(currentContent);
        
        isOpen = false;
        currentContent = "";
        
        // Rest is cleaned text
        result += afterClose;
      } else {
        // Only opening tag, accumulate content
        currentContent += afterOpen;
        // Emit reasoning with current content (streaming)
        reasoningEvents.push(currentContent);
      }
    } else if (closeIndex !== -1) {
      // Closing tag found
      const beforeClose = text.substring(0, closeIndex);
      const afterClose = text.substring(closeIndex + closeTag.length);
      
      if (isOpen) {
        // Add content before close to thinking
        currentContent += beforeClose;
        // Emit final reasoning event
        reasoningEvents.push(currentContent);
        
        isOpen = false;
        currentContent = "";
      }
      
      // Rest is cleaned text
      result += afterClose;
    } else if (isOpen) {
      // We're inside thinking block, accumulate content
      currentContent += text;
      // Emit streaming reasoning event
      reasoningEvents.push(currentContent);
      // Nothing goes to cleaned output
      result = "";
    } else {
      // Normal text, no thinking tags
      result += text;
    }

    remainingText = result;
  }

  return {
    cleanedText: remainingText,
    isThinkingTagOpen: isOpen,
    currentThinkingContent: currentContent,
    reasoningEvents
  };
}
