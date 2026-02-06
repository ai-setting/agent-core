/**
 * @fileoverview LLM tool implementations.
 *
 * Tools:
 * - invoke_llm: Internal LLM invocation - returns final result and emits events via hook
 * - system1_intuitive_reasoning: System 1 direct LLM call for simple tasks
 */

import { z } from "zod";
import type { LLMAdapter, LLMMessage, LLMToolCall, LLMUsage, LLMTool } from "../llm/index.js";
import type { ToolInfo, ToolResult, ToolContext } from "../../types/index.js";

export interface InvokeLLMConfig {
  adapter: LLMAdapter;
  defaultModel: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface LLMResult {
  content: string;
  reasoning?: string;
  tool_calls?: LLMToolCall[];
  usage?: LLMUsage;
  model: string;
}

interface ToolMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

const formatMessages = (messages: ToolMessage[]): LLMMessage[] => {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
    ...(msg.name && { name: msg.name }),
  }));
};

const getModel = (args: Record<string, unknown>, config: InvokeLLMConfig): string => {
  if (typeof args.model === "string" && args.model.length > 0) {
    return args.model;
  }
  return config.defaultModel;
};

function createLLMTool(config: InvokeLLMConfig, options: {
  name: string;
  description: string;
  returnToolCalls: boolean;
}): ToolInfo {
  const toolInfo: ToolInfo = {
    name: options.name,
    description: options.description,

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
            parameters: z.record(z.unknown()),
          }),
        )
        .optional()
        .describe("Available tools for the LLM to call"),

      model: z.string().optional().describe("Model identifier (defaults to configured default)"),

      temperature: z.number().min(0).max(2).optional().describe("Temperature for sampling (0-2)"),

      maxTokens: z.number().positive().optional().describe("Maximum output tokens"),

      topP: z.number().min(0).max(1).optional().describe("Top-p sampling parameter"),

      stop: z.array(z.string()).optional().describe("Stop sequences"),

      frequencyPenalty: z.number().min(-2).max(2).optional().describe("Frequency penalty"),

      presencePenalty: z.number().min(-2).max(2).optional().describe("Presence penalty"),
    }),

    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const startTime = Date.now();
      const messages = formatMessages(args.messages as ToolMessage[]);
      const model = getModel(args, config);
      const allTools = args.tools as LLMTool[] | undefined;
      const tools = allTools?.filter(
        (t) => t.name !== "invoke_llm" && t.name !== "system1_intuitive_reasoning"
      );

      let textContent = "";
      let reasoningContent = "";
      const toolCalls: LLMToolCall[] = [];

      try {
        await config.adapter.stream(
          {
            messages,
            tools,
            config: {
              model,
              temperature: args.temperature as number | undefined,
              maxTokens: args.maxTokens as number | undefined,
              topP: args.topP as number | undefined,
              stop: args.stop as string[] | undefined,
              frequencyPenalty: args.frequencyPenalty as number | undefined,
              presencePenalty: args.presencePenalty as number | undefined,
            },
            abort: ctx.abort,
            metadata: ctx.metadata,
          },
          {
            onStart: () => {},

            onContent: (chunk: string, type: "text" | "reasoning" | "tool-call") => {
              if (type === "reasoning") {
                reasoningContent += chunk;
              } else {
                textContent += chunk;
              }
            },

            onToolCall: (toolName: string, toolArgs: Record<string, unknown>, toolCallId: string) => {
              const toolCall: LLMToolCall = {
                id: toolCallId,
                function: {
                  name: toolName,
                  arguments: JSON.stringify(toolArgs),
                },
              };
              toolCalls.push(toolCall);
            },

            onUsage: (usage: LLMUsage) => {},

            onComplete: (usage?: LLMUsage) => {},

            onError: (error: Error) => {
              throw error;
            },
          },
        );

        const output: Record<string, unknown> = {
          content: textContent,
          reasoning: reasoningContent || undefined,
          model,
          provider: config.adapter.name,
        };

        if (options.returnToolCalls && toolCalls.length > 0) {
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

  return toolInfo;
}

export function createInvokeLLM(config: InvokeLLMConfig): ToolInfo {
  return createLLMTool(config, {
    name: "invoke_llm",
    description:
      "Internal LLM invocation interface. " +
      "Returns final result with optional tool_calls. " +
      "Framework internal use only - agents should not actively select this tool.",
    returnToolCalls: true,
  });
}

export function createSystem1IntuitiveReasoning(config: InvokeLLMConfig): ToolInfo {
  return createLLMTool(config, {
    name: "system1_intuitive_reasoning",
    description:
      "System 1 Intuitive Reasoning: Direct LLM call for simple tasks. " +
      "Use for Q&A, text generation, translation, summarization. " +
      "Returns complete generated text. " +
      "Select this when the query needs LLM's knowledge or creativity.",
    returnToolCalls: false,
  });
}
