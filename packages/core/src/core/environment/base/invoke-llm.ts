/**
 * @fileoverview LLM invocation core implementation.
 *
 * This module provides the core LLM invocation functionality that is used
 * by BaseEnvironment as a native capability, not as a tool.
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolInfo, ToolResult, ToolContext } from "../../types/index.js";
import { createLogger } from "../../../utils/logger.js";

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

interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
}

const BUILTIN_PROVIDERS: Record<string, { baseURL?: string; defaultModel: string }> = {
  openai: { baseURL: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
  moonshot: { baseURL: "https://api.moonshot.cn/v1", defaultModel: "kimi-k2.5" },
  kimi: { baseURL: "https://api.moonshot.cn/v1", defaultModel: "kimi-k2.5" },
  deepseek: { baseURL: "https://api.deepseek.com", defaultModel: "deepseek-chat" },
};

function getProviderConfig(provider: string): { baseURL?: string; defaultModel: string } {
  return BUILTIN_PROVIDERS[provider] || { defaultModel: provider };
}

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

function convertTools(tools: ToolInfo[]): any[] {
  const result = tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: extractToolSchema(t.parameters),
    },
  }));
  invokeLLMLogger.debug("[convertTools] Converting tools", { input: tools.map(t => t.name), output: result.map(t => t.function.name) });
  return result;
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
 * Core LLM invocation function - used by BaseEnvironment as a native capability
 */
export async function invokeLLM(
  config: InvokeLLMConfig,
  options: LLMOptions,
  ctx: ToolContext,
  eventHandler?: StreamEventHandler
): Promise<ToolResult> {
  const startTime = Date.now();
  const messages = options.messages;
  const tools = options.tools;
  const stream = options.stream ?? true;

  invokeLLMLogger.info("[invokeLLM] Function called", { toolCount: tools?.length || 0, stream });

  const requestBody: any = {
    model: options.model || config.model,
    messages: messages.map((m) => {
      const msg: any = {
        role: m.role,
        content: m.content,
      };
      if (m.name) {
        msg.name = m.name;
      }
      if (m.reasoning_content) {
        msg.reasoning_content = m.reasoning_content;
      }
      if (m.tool_calls && m.role === "assistant") {
        msg.tool_calls = m.tool_calls;
      }
      if (m.tool_call_id && m.role === "tool") {
        msg.tool_call_id = m.tool_call_id;
      }
      return msg;
    }),
    stream,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
  };

  if (tools && tools.length > 0) {
    requestBody.tools = convertTools(tools);
    requestBody.tool_choice = "auto";
    invokeLLMLogger.info("[invokeLLM] Sending tools to LLM", { count: requestBody.tools.length });
  } else {
    invokeLLMLogger.info("[invokeLLM] Sending NO tools to LLM");
  }

  try {
    invokeLLMLogger.debug("[invokeLLM] About to fetch LLM API");
    const response = await fetch(`${config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: ctx.abort,
    });
    invokeLLMLogger.info("[invokeLLM] Fetch completed", { status: response.status });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    if (!stream) {
      // Non-streaming response
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content || "";
      return {
        success: true,
        output: content,
        metadata: {
          execution_time_ms: Date.now() - startTime,
        },
      };
    }

    // Streaming response
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Failed to get response reader");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let reasoningContent = "";
    const toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> = [];

    // Emit start event
    if (eventHandler?.onStart) {
      eventHandler.onStart({ model: config.model });
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          invokeLLMLogger.info("[invokeLLM] Stream reading done");
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const chunk: StreamChunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
              content += delta.content;
              invokeLLMLogger.debug("[invokeLLM] onText called", { contentLength: content.length });
              if (eventHandler?.onText) {
                eventHandler.onText(content, delta.content);
              }
            }

            if (delta.reasoning_content) {
              reasoningContent += delta.reasoning_content;
              invokeLLMLogger.debug("[invokeLLM] onReasoning called", { reasoningLength: reasoningContent.length });
              if (eventHandler?.onReasoning) {
                eventHandler.onReasoning(reasoningContent);
              }
            }

            if (delta.tool_calls) {
              invokeLLMLogger.debug("[invokeLLM] onToolCall called", { count: delta.tool_calls.length });
              for (const tc of delta.tool_calls) {
                if (tc.index !== undefined) {
                  if (!toolCalls[tc.index]) {
                    toolCalls[tc.index] = {
                      id: tc.id || `call-${tc.index}`,
                      function: { name: "", arguments: "" },
                    };
                  }
                  if (tc.function?.name) {
                    toolCalls[tc.index].function.name = tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    toolCalls[tc.index].function.arguments += tc.function.arguments;
                  }
                }
              }
              
              // Emit tool_call event
              if (eventHandler?.onToolCall && toolCalls.length > 0) {
                const lastTool = toolCalls[toolCalls.length - 1];
                if (lastTool.function.name) {
                  eventHandler.onToolCall(
                    lastTool.function.name,
                    JSON.parse(lastTool.function.arguments || "{}"),
                    lastTool.id
                  );
                }
              }
            }
          } catch {
            // Skip parse errors
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        invokeLLMLogger.info("[invokeLLM] Stream aborted by user");
        throw err;
      } else {
        throw err;
      }
    }

    // Filter out invalid tool calls (no function name)
    const validToolCalls = toolCalls.filter(tc => tc.function?.name && tc.function.name.trim() !== "");
    
    const output: LLMOutput = {
      content,
      reasoning: reasoningContent,
      model: config.model,
    };

    if (validToolCalls.length > 0) {
      output.tool_calls = validToolCalls;
      invokeLLMLogger.debug("[invokeLLM] Returning with tool_calls", { count: validToolCalls.length, tools: validToolCalls.map(t => t.function.name) });
    } else {
      invokeLLMLogger.debug("[invokeLLM] Returning content (no tool_calls)");
      // Emit completed event only when returning final content (no tool calls)
      if (eventHandler?.onCompleted) {
        eventHandler.onCompleted(content, { model: config.model });
      }
    }

    return {
      success: true,
      output,
      metadata: {
        execution_time_ms: Date.now() - startTime,
      },
    };
  } catch (error) {
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
    { ...options, stream: false },
    ctx
  );
}

export function createLLMConfigFromEnv(model: string): InvokeLLMConfig | undefined {
  const parts = model.split("/");
  const provider = parts[0] || "openai";
  const modelId = parts.slice(1).join("/") || getProviderConfig(provider).defaultModel;

  const apiKey = process.env.LLM_API_KEY || process.env[`${provider.toUpperCase()}_API_KEY`];
  if (!apiKey) return undefined;

  const baseURL = process.env.LLM_BASE_URL || process.env[`${provider.toUpperCase()}_BASE_URL`] || getProviderConfig(provider).baseURL;

  return {
    model: modelId,
    baseURL: baseURL || "",
    apiKey,
  };
}

/**
 * Create LLM config from explicit parameters
 * Used when configuration is loaded from config files
 */
export function createLLMConfig(
  model: string,
  baseURL: string,
  apiKey: string
): InvokeLLMConfig {
  const parts = model.split("/");
  const provider = parts[0] || "openai";
  const modelId = parts.slice(1).join("/") || getProviderConfig(provider).defaultModel;

  return {
    model: modelId,
    baseURL: baseURL || getProviderConfig(provider).baseURL || "",
    apiKey,
  };
}

// Legacy tool creators - kept for backward compatibility but not used internally
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
