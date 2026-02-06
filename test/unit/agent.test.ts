/**
 * @fileoverview Unit tests for enhanced Agent with error handling and optimization.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Agent } from "../../src/agent/index.js";
import type { Environment, Prompt } from "../../src/environment/index.js";
import type { Tool, Context, Event } from "../../src/types/index.js";

describe("Enhanced Agent", () => {
  let mockEnv: Environment;
  let mockTools: Tool[];
  let mockPrompt: Prompt;
  let mockContext: Context;
  let responseQueue: Array<{ success: boolean; output: Record<string, unknown>; error?: string }>;
  let actionLog: Array<{ tool: string; args: Record<string, unknown> }>;

  function createMockEnv(): Environment {
    return {
      handle_query: async () => "",
      handle_action: async (action, ctx) => {
        actionLog.push({ tool: action.tool_name, args: action.args });

        if (responseQueue.length === 0) {
          return {
            success: true,
            output: { content: "Final response" },
            metadata: { execution_time_ms: 10 },
          };
        }

        const response = responseQueue.shift()!;
        return {
          success: response.success,
          output: response.output,
          error: response.error,
          metadata: { execution_time_ms: 10 },
        };
      },
      getTools: () => mockTools,
      getPrompt: () => mockPrompt,
      subscribe: () => {},
      unsubscribe: () => {},
      getStream: () => undefined,
      pushToSubscribers: () => {},
      sendResponse: async () => "Response sent to user",
    } as unknown as Environment;
  }

  beforeEach(() => {
    actionLog = [];
    responseQueue = [];
    mockEnv = createMockEnv();

    mockTools = [
      {
        name: "get_weather",
        description: "Get weather",
        parameters: {} as any,
        execute: async () => ({ success: true, output: "Sunny", metadata: {} }),
      },
      {
        name: "response_user",
        description: "Send response",
        parameters: {} as any,
        execute: async () => ({ success: true, output: "Response sent", metadata: {} }),
      },
    ];

    mockPrompt = { id: "system", content: "You are a helpful assistant." };
    mockContext = {};
  });

  test("creates agent with config", () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    const agent = new Agent(event, mockEnv, mockTools, mockPrompt, mockContext, {
      maxIterations: 10,
      doomLoopThreshold: 2,
    });

    expect(agent).toBeDefined();
  });

  test("completes with simple response", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "What is 2+2?",
    };

    responseQueue.push({
      success: true,
      output: { content: "The answer is 4" },
    });

    const agent = new Agent(event, mockEnv, mockTools, mockPrompt, mockContext);
    const result = await agent.run();

    expect(result).toBe("The answer is 4");
    expect(actionLog.length).toBe(1);
  });

  test("retries on transient LLM error", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    responseQueue.push({
      success: false,
      output: {},
      error: "Rate limited, please retry",
    });

    responseQueue.push({
      success: true,
      output: { content: "Success after retry" },
    });

    const agent = new Agent(event, mockEnv, mockTools, mockPrompt, mockContext);
    const result = await agent.run();

    expect(result).toBe("Success after retry");
    expect(actionLog.length).toBe(2);
  });

  test("throws on non-retryable error", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    responseQueue.push({
      success: false,
      output: {},
      error: "Tool not found: invalid_tool",
    });

    const agent = new Agent(event, mockEnv, mockTools, mockPrompt, mockContext);
    expect(agent.run()).rejects.toThrow("Tool not found");
  });

  test("detects doom loop", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    responseQueue.push({
      success: true,
      output: {
        content: "Let me check...",
        tool_calls: [
          {
            id: "call-1",
            function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
          },
        ],
      },
    });

    responseQueue.push({
      success: true,
      output: { temp: "25°C" },
    });

    responseQueue.push({
      success: true,
      output: {
        content: "Let me check again...",
        tool_calls: [
          {
            id: "call-2",
            function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
          },
        ],
      },
    });

    responseQueue.push({
      success: true,
      output: { temp: "25°C" },
    });

    responseQueue.push({
      success: true,
      output: {
        content: "One more time...",
        tool_calls: [
          {
            id: "call-3",
            function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
          },
        ],
      },
    });

    const agent = new Agent(event, mockEnv, mockTools, mockPrompt, mockContext, {
      doomLoopThreshold: 3,
    });

    expect(agent.run()).rejects.toThrow("Doom loop detected");
  });

  test("continues after tool result", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    responseQueue.push({
      success: true,
      output: {
        content: "The weather is",
        tool_calls: [
          {
            id: "call-1",
            function: { name: "get_weather", arguments: '{"city":"Beijing"}' },
          },
        ],
      },
    });

    responseQueue.push({
      success: true,
      output: { temp: "25°C" },
    });

    responseQueue.push({
      success: true,
      output: { content: "25°C" },
    });

    const agent = new Agent(event, mockEnv, mockTools, mockPrompt, mockContext);
    const result = await agent.run();

    expect(result).toBe("25°C");
  });

  test("uses factory function", () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    const agent = new Agent(event, mockEnv, mockTools, mockPrompt, mockContext, {
      maxIterations: 5,
    });

    expect(agent).toBeDefined();
  });

  test("getIterationCount returns correct value", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    responseQueue.push({
      success: true,
      output: { content: "Simple response" },
    });

    const agent = new Agent(event, mockEnv, mockTools, mockPrompt, mockContext);
    await agent.run();

    expect(agent.getIterationCount()).toBe(1);
  });

  test("reset clears state", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    responseQueue.push({
      success: true,
      output: { content: "Response 1" },
    });

    const agent = new Agent(event, mockEnv, mockTools, mockPrompt, mockContext);
    await agent.run();

    expect(agent.getIterationCount()).toBe(1);

    agent.reset();

    responseQueue.push({
      success: true,
      output: { content: "Response 2" },
    });

    await agent.run();

    expect(agent.getIterationCount()).toBe(1);
  });

  test("handles abort signal", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    const abortController = new AbortController();
    const abortContext: Context = {
      ...mockContext,
      abort: abortController.signal,
    };

    responseQueue.push({
      success: true,
      output: { content: "Slow response..." },
    });

    const agent = new Agent(event, mockEnv, mockTools, mockPrompt, abortContext);

    abortController.abort();

    expect(agent.run()).rejects.toThrow("aborted");
  });

  test("configures retry parameters", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    let attempt = 0;

    const customEnv = {
      ...mockEnv,
      handle_action: async (action, ctx) => {
        attempt++;
        if (attempt < 3) {
          return {
            success: false,
            output: {},
            error: "Rate limited",
            metadata: {},
          };
        }
        return {
          success: true,
          output: { content: "Success" },
          metadata: {},
        };
      },
    } as unknown as Environment;

    const agent = new Agent(event, customEnv, mockTools, mockPrompt, mockContext, {
      retryDelayMs: 10,
      retryBackoffFactor: 2,
      maxRetryDelayMs: 100,
    });

    const result = await agent.run();

    expect(result).toBe("Success");
    expect(attempt).toBe(3);
  });

  test("handles empty response gracefully", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    responseQueue.push({
      success: true,
      output: { content: "" },
    });

    const agent = new Agent(event, mockEnv, mockTools, mockPrompt, mockContext);
    const result = await agent.run();

    expect(result).toBe("(no response)");
  });

  test("handles undefined tool_calls gracefully", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    responseQueue.push({
      success: true,
      output: { content: "Hello!" },
    });

    const agent = new Agent(event, mockEnv, mockTools, mockPrompt, mockContext);
    const result = await agent.run();

    expect(result).toBe("Hello!");
  });

  test("handles response_user tool", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    responseQueue.push({
      success: true,
      output: {
        content: "Let me respond...",
        tool_calls: [
          {
            id: "call-1",
            function: { name: "response_user", arguments: '{"text":"Hello!"}' },
          },
        ],
      },
    });

    responseQueue.push({
      success: true,
      output: { output: "Response sent" },
    });

    responseQueue.push({
      success: true,
      output: { content: "Done" },
    });

    const agent = new Agent(event, mockEnv, mockTools, mockPrompt, mockContext);
    const result = await agent.run();

    expect(result).toBe("Done");
  });
});

describe("Agent with tools parameter restriction", () => {
  let mockEnv: Environment;
  let mockPrompt: Prompt;
  let mockContext: Context;
  let responseQueue: Array<{ success: boolean; output: Record<string, unknown>; error?: string }>;
  let actionLog: Array<{ tool: string; args: Record<string, unknown> }>;
  let capturedTools: Array<{ name: string; description?: string; parameters: Record<string, unknown> }> | undefined;

  function createMockEnv(): Environment {
    return {
      handle_query: async () => "",
      handle_action: async (action, ctx) => {
        actionLog.push({ tool: action.tool_name, args: action.args });

        if (action.tool_name === "invoke_llm") {
          capturedTools = (action.args as Record<string, unknown>).tools as typeof capturedTools;
        }

        if (responseQueue.length === 0) {
          return {
            success: true,
            output: { content: "Final response" },
            metadata: { execution_time_ms: 10 },
          };
        }

        const response = responseQueue.shift()!;
        return {
          success: response.success,
          output: response.output,
          error: response.error,
          metadata: { execution_time_ms: 10 },
        };
      },
      getTools: () => [],
      getPrompt: () => mockPrompt,
      subscribe: () => {},
      unsubscribe: () => {},
      getStream: () => undefined,
      pushToSubscribers: () => {},
    } as unknown as Environment;
  }

  beforeEach(() => {
    actionLog = [];
    responseQueue = [];
    capturedTools = undefined;
    mockEnv = createMockEnv();

    mockPrompt = { id: "system", content: "You are a helpful assistant." };
    mockContext = {};
  });

  test("passes tools to invoke_llm when tools are provided", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    responseQueue.push({
      success: true,
      output: { content: "Hi there!" },
    });

    const restrictedTools = [
      {
        name: "bash",
        description: "Execute bash commands",
        parameters: { command: { type: "string" } },
      },
      {
        name: "read_file",
        description: "Read file contents",
        parameters: { path: { type: "string" } },
      },
    ];

    const agent = new Agent(event, mockEnv, restrictedTools as any, mockPrompt, mockContext);
    await agent.run();

    expect(capturedTools).toBeDefined();
    expect(capturedTools!.length).toBe(2);
    expect(capturedTools![0].name).toBe("bash");
    expect(capturedTools![1].name).toBe("read_file");
  });

  test("does not pass tools when empty tools array is provided", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Hello",
    };

    responseQueue.push({
      success: true,
      output: { content: "Hi there!" },
    });

    const emptyTools: any[] = [];

    const agent = new Agent(event, mockEnv, emptyTools, mockPrompt, mockContext);
    await agent.run();

    expect(capturedTools).toBeUndefined();
  });

  test("filters available tools when subset is provided", async () => {
    const event: Event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user",
      content: "Check weather",
    };

    responseQueue.push({
      success: true,
      output: { content: "Sunny!" },
    });

    const onlyWeatherTool = [
      {
        name: "get_weather",
        description: "Get weather information",
        parameters: { city: { type: "string" } },
      },
    ];

    const agent = new Agent(event, mockEnv, onlyWeatherTool as any, mockPrompt, mockContext);
    await agent.run();

    expect(capturedTools).toBeDefined();
    expect(capturedTools!.length).toBe(1);
    expect(capturedTools![0].name).toBe("get_weather");
  });
});
