/**
 * @fileoverview LLM tool implementations using direct API calls.
 *
 * Tools:
 * - invoke_llm: Internal LLM invocation with tool support
 * - system1_intuitive_reasoning: Direct LLM call for simple tasks
 */

import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolInfo, ToolResult, ToolContext } from "../../types/index.js";

export interface InvokeLLMConfig {
  model: string;
  baseURL: string;
  apiKey: string;
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
  const result = tools
    .filter((t) => t.name !== "invoke_llm" && t.name !== "system1_intuitive_reasoning")
    .map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: extractToolSchema(t.parameters),
      },
    }));
  console.log(`[convertTools] Input: ${tools.map(t => t.name).join(", ")} -> Output: ${result.map(t => t.function.name).join(", ")}`);
  return result;
}

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
        .describe("Available tools - NOTE: do NOT include invoke_llm or system1_intuitive_reasoning to avoid recursion"),
      model: z.string().optional().describe("Model identifier"),
      temperature: z.number().min(0).max(2).optional().describe("Temperature (0-2)"),
      maxTokens: z.number().positive().optional().describe("Maximum output tokens"),
    }),
    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const startTime = Date.now();
      const messages = args.messages as Array<{
        role: string;
        content: string;
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
      }>;
      let tools = args.tools as ToolInfo[] | undefined;

      console.log(`[invoke_llm] Received ${tools?.length || 0} tools: ${tools?.map(t => t.name).join(", ") || "none"}`);

      // Prevent recursion: filter out invoke_llm and system1_intuitive_reasoning
      if (tools) {
        const beforeCount = tools.length;
        tools = tools.filter(t => t.name !== "invoke_llm" && t.name !== "system1_intuitive_reasoning");
        console.log(`[invoke_llm] Filtered tools: ${beforeCount} -> ${tools.length}`);
        if (tools.length === 0) {
          tools = undefined;
        }
      }

      const requestBody: any = {
        model: config.model,
        messages: messages.map((m) => {
          const msg: any = {
            role: m.role,
            content: m.content,
          };
          if (m.name) {
            msg.name = m.name;
          }
          // Include reasoning_content for Kimi thinking mode
          if (m.reasoning_content) {
            msg.reasoning_content = m.reasoning_content;
          }
          // Include tool_calls for assistant messages
          if (m.tool_calls && m.role === "assistant") {
            msg.tool_calls = m.tool_calls;
          }
          // Include tool_call_id for tool messages (required by Kimi)
          if (m.tool_call_id && m.role === "tool") {
            msg.tool_call_id = m.tool_call_id;
          }
          return msg;
        }),
        stream: true,
        temperature: args.temperature,
        max_tokens: args.maxTokens,
      };

      if (tools && tools.length > 0) {
        requestBody.tools = convertTools(tools);
        requestBody.tool_choice = "auto";
        console.log(`[invoke_llm] Sending ${requestBody.tools.length} tools to LLM: ${requestBody.tools.map((t: any) => t.function.name).join(", ")}`);
      } else {
        console.log(`[invoke_llm] Sending NO tools to LLM`);
      }

      try {
        const response = await fetch(`${config.baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: ctx.abort,
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`API error: ${response.status} - ${error}`);
        }

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
        const sessionId = ctx.session_id || (ctx.metadata as any)?.session_id || "default";
        const messageId = (ctx.metadata as any)?.message_id || `msg_${Date.now()}`;
        const env = (ctx as any).env;
        const eventContext = { session_id: sessionId, message_id: messageId };
        
        if (env?.emitStreamEvent) {
          env.emitStreamEvent({
            type: "start",
            metadata: { model: config.model },
          }, eventContext);
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

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
                
                // Emit text event
                if (env?.emitStreamEvent) {
                  env.emitStreamEvent({
                    type: "text",
                    content,
                    delta: delta.content,
                  }, eventContext);
                }
              }

              if (delta.reasoning_content) {
                reasoningContent += delta.reasoning_content;
                
                // Emit reasoning event
                if (env?.emitStreamEvent) {
                  env.emitStreamEvent({
                    type: "reasoning",
                    content: reasoningContent,
                  }, eventContext);
                }
              }

              if (delta.tool_calls) {
                console.log(`[invoke_llm] AI requested tool_calls: ${delta.tool_calls.map((tc: any) => tc.function?.name || "unknown").join(", ")}`);
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
                if (env?.emitStreamEvent && toolCalls.length > 0) {
                  const lastTool = toolCalls[toolCalls.length - 1];
                  if (lastTool.function.name) {
                    env.emitStreamEvent({
                      type: "tool_call",
                      tool_name: lastTool.function.name,
                      tool_args: JSON.parse(lastTool.function.arguments || "{}"),
                      tool_call_id: lastTool.id,
                    }, eventContext);
                  }
                }
              }
            } catch {
              // Skip parse errors
            }
          }
        }

        // Filter out invalid tool calls (no function name)
        const validToolCalls = toolCalls.filter(tc => tc.function?.name && tc.function.name.trim() !== "");
        
        const output: Record<string, unknown> = {
          content,
          reasoning: reasoningContent,
          model: config.model,
        };

        if (validToolCalls.length > 0) {
          output.tool_calls = validToolCalls;
          console.log(`[invoke_llm] Returning with ${validToolCalls.length} tool_calls: ${validToolCalls.map(t => t.function.name).join(", ")}`);
          // Note: Don't emit completed event here - agent will continue processing
        } else {
          console.log(`[invoke_llm] Returning content (no tool_calls)`);
          // Emit completed event only when returning final content (no tool calls)
          if (env?.emitStreamEvent) {
            env.emitStreamEvent({
              type: "completed",
              content,
              metadata: { model: config.model },
            }, eventContext);
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
      const startTime = Date.now();
      const messages = args.messages as Array<{
        role: string;
        content: string;
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
      }>;

      const requestBody: any = {
        model: config.model,
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
        stream: false,
        temperature: args.temperature,
        max_tokens: args.maxTokens,
      };

      try {
        const response = await fetch(`${config.baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: ctx.abort,
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`API error: ${response.status} - ${error}`);
        }

        const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content || "";

        return {
          success: true,
          output: content,
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
    },
  };
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
