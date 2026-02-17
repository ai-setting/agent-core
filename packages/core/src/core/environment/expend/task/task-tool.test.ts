/**
 * @fileoverview Unit tests for TaskTool.
 */

import { describe, test, expect, beforeEach, vi } from "bun:test";
import { createTaskTool } from "./task-tool.js";
import { TaskToolParameters } from "./types.js";

describe("TaskTool - Parameters Validation", () => {
  test("should have correct parameter schema", () => {
    expect(TaskToolParameters.shape.description).toBeDefined();
    expect(TaskToolParameters.shape.prompt).toBeDefined();
    expect(TaskToolParameters.shape.subagent_type).toBeDefined();
    expect(TaskToolParameters.shape.background).toBeDefined();
    expect(TaskToolParameters.shape.timeout).toBeDefined();
    expect(TaskToolParameters.shape.cleanup).toBeDefined();
  });

  test("should have default values", () => {
    const params = TaskToolParameters.parse({
      description: "test",
      prompt: "do something",
    });
    
    expect(params.subagent_type).toBe("general");
    expect(params.background).toBe(false);
  });
});

describe("TaskTool - Tool Definition", () => {
  test("should create task tool with correct name", () => {
    const mockEnv = createMockEnv();
    const tool = createTaskTool(mockEnv);
    
    expect(tool.name).toBe("task");
  });

  test("should have comprehensive description", () => {
    const mockEnv = createMockEnv();
    const tool = createTaskTool(mockEnv);
    
    expect(tool.description).toContain("Launch a new agent");
    expect(tool.description).toContain("subagent");
    expect(tool.description).toContain("general");
    expect(tool.description).toContain("explore");
    expect(tool.description).toContain("background");
    expect(tool.description).toContain("When to use");
    expect(tool.description).toContain("When NOT to use");
    expect(tool.description).toContain("Example");
  });

  test("should reference available subagents in description", () => {
    const mockEnv = createMockEnv();
    const tool = createTaskTool(mockEnv);
    
    expect(tool.description).toContain("- general:");
    expect(tool.description).toContain("- explore:");
  });
});

describe("TaskTool - Execution with Mock", () => {
  let mockEnv: any;

  beforeEach(() => {
    mockEnv = createMockEnv();
  });

  test("should reject unknown subagent type", async () => {
    const tool = createTaskTool(mockEnv);
    
    const result = await tool.execute({
      description: "test",
      prompt: "do something",
      subagent_type: "nonexistent",
    }, {});
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown subagent type");
  });

  test("should return error when parent session not found", async () => {
    const mockEnvNoSession = {
      getSession: vi.fn().mockReturnValue(undefined),
      createSession: vi.fn(),
      handle_query: vi.fn(),
      publishEvent: vi.fn(),
    };
    
    const tool = createTaskTool(mockEnvNoSession);
    
    const result = await tool.execute({
      description: "test",
      prompt: "do something",
      subagent_type: "general",
    }, { session_id: "nonexistent" });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain("Parent session not found");
  });

  test("should include metadata in output on success", async () => {
    const tool = createTaskTool(mockEnv);
    
    const result = await tool.execute({
      description: "test task",
      prompt: "return success",
      subagent_type: "general",
    }, { session_id: "test-session" });
    
    expect(result.success).toBe(true);
    expect(result.output).toContain("<task_metadata>");
    expect(result.output).toContain("session_id:");
  });
});

describe("TaskTool - Background Mode", () => {
  test("should return accepted status for background tasks", async () => {
    const mockEnv = {
      getSession: vi.fn().mockReturnValue({
        id: "test-session",
        info: { metadata: {} },
        addMessage: vi.fn(),
        addUserMessage: vi.fn(),
        addAssistantMessage: vi.fn(),
        toHistory: vi.fn().mockReturnValue([]),
      }),
      createSession: vi.fn().mockReturnValue({
        id: "mock-sub-session",
        info: { metadata: { subagent_type: "general" } },
        addMessage: vi.fn(),
        addUserMessage: vi.fn(),
        addAssistantMessage: vi.fn(),
        toHistory: vi.fn().mockReturnValue([]),
      }),
      handle_query: vi.fn().mockResolvedValue("Task completed"),
      publishEvent: vi.fn().mockResolvedValue(undefined),
    };
    
    const tool = createTaskTool(mockEnv);
    
    const result = await tool.execute({
      description: "background test",
      prompt: "do something long",
      subagent_type: "general",
      background: true,
    }, { session_id: "test-session" });
    
    if (!result.success) {
      console.log("Error:", result.error);
    }
    expect(result.success).toBe(true);
    expect(result.metadata?.status).toBe("accepted");
    expect(result.output).toContain("Background task accepted");
  });

  test("should include task_id in metadata for background tasks", async () => {
    const mockEnv = {
      getSession: vi.fn().mockReturnValue({
        id: "test-session",
        info: { metadata: {} },
        addMessage: vi.fn(),
        addUserMessage: vi.fn(),
        addAssistantMessage: vi.fn(),
        toHistory: vi.fn().mockReturnValue([]),
      }),
      createSession: vi.fn().mockReturnValue({
        id: "mock-sub-session",
        info: { metadata: { subagent_type: "general" } },
        addMessage: vi.fn(),
        addUserMessage: vi.fn(),
        addAssistantMessage: vi.fn(),
        toHistory: vi.fn().mockReturnValue([]),
      }),
      handle_query: vi.fn().mockResolvedValue("Task completed"),
      publishEvent: vi.fn().mockResolvedValue(undefined),
    };
    
    const tool = createTaskTool(mockEnv);
    
    const result = await tool.execute({
      description: "background test",
      prompt: "do something",
      subagent_type: "general",
      background: true,
    }, { session_id: "test-session" });
    
    expect(result.metadata?.taskId).toBeDefined();
    expect(result.metadata?.sessionId).toBeDefined();
  });
});

function createMockEnv(): any {
  const mockParentSession = {
    id: "test-session",
    info: { metadata: {} },
    addMessage: vi.fn(),
    addUserMessage: vi.fn(),
    addAssistantMessage: vi.fn(),
    toHistory: vi.fn().mockReturnValue([]),
  };

  const mockSession = {
    id: "mock-sub-session",
    info: {
      metadata: {
        subagent_type: "general",
      },
    },
    addMessage: vi.fn().mockReturnValue("msg_123"),
    addUserMessage: vi.fn().mockReturnValue("msg_user"),
    addAssistantMessage: vi.fn().mockReturnValue("msg_assistant"),
    toHistory: vi.fn().mockReturnValue([
      { role: "system", content: "You are a subagent" },
    ]),
  };

  return {
    getSession: vi.fn().mockImplementation((id: string) => {
      if (id === "test-session" || id === "context-session" || id === "default") {
        return mockParentSession;
      }
      return mockSession;
    }),
    createSession: vi.fn().mockReturnValue(mockSession),
    handle_query: vi.fn().mockResolvedValue("Task completed successfully"),
    publishEvent: vi.fn().mockResolvedValue(undefined),
    registerTool: vi.fn(),
  };
}
