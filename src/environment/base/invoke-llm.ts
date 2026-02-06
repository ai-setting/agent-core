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
  return tools
    .filter((t) => t.name !== "invoke_llm" && t.name !== "system1_intuitive_reasoning")
    .map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description ?? "",
        parameters: extractToolSchema(t.parameters),
      },
    }));
}

export function createInvokeLLM(config: InvokeLLMConfig): ToolInfo {
  return {
    name: "invoke_llm",
    description: "Internal LLM invocation with tool support. Framework internal use.",
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
        .describe("Available tools for the LLM to call"),
      model: z.string().optional().describe("Model identifier"),
      temperature: z.number().min(0).max(2).optional().describe("Temperature (0-2)"),
      maxTokens: z.number().positive().optional().describe("Maximum output tokens"),
    }),
    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const startTime = Date.now();
      const messages = args.messages as Array<{ role: string; content: string; name?: string }>;
      const tools = args.tools as ToolInfo[] | undefined;

      const requestBody: any = {
        model: config.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          name: m.name,
        })),
        stream: true,
        temperature: args.temperature,
        max_tokens: args.maxTokens,
      };

      if (tools && tools.length > 0) {
        requestBody.tools = convertTools(tools);
        requestBody.tool_choice = "auto";
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
        const toolCalls: Array<{ id: string; function: { name: string; arguments: string } }> = [];

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
              }

              if (delta.tool_calls) {
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
              }
            } catch {
              // Skip parse errors
            }
          }
        }

        const output: Record<string, unknown> = {
          content,
          model: config.model,
        };

        if (toolCalls.length > 0) {
          output.tool_calls = toolCalls;
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
      const messages = args.messages as Array<{ role: string; content: string; name?: string }>;

      const requestBody = {
        model: config.model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          name: m.name,
        })),
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
