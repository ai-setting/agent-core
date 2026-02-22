/**
 * @fileoverview Unit tests for StopTaskTool.
 */

import { describe, test, expect, beforeEach, vi } from "bun:test";
import { createStopTaskTool } from "./stop-task-tool.js";
import { BackgroundTaskManager } from "./background-task-manager.js";

describe("StopTaskTool", () => {
  let mockManager: BackgroundTaskManager;
  let tool: ReturnType<typeof createStopTaskTool>;

  beforeEach(() => {
    mockManager = {
      stopTask: vi.fn(),
      getTask: vi.fn(),
      listTasks: vi.fn(),
    } as any;
    
    tool = createStopTaskTool(mockManager);
  });

  describe("Tool Definition", () => {
    test("should have correct name", () => {
      expect(tool.name).toBe("stop_task");
    });

    test("should have description", () => {
      expect(tool.description).toContain("Stop a running background task");
    });

    test("should have task_id parameter", () => {
      const params = tool.parameters as any;
      expect(params._def.shape().task_id).toBeDefined();
    });
  });

  describe("Execution", () => {
    test("should return success when task stopped", async () => {
      (mockManager.stopTask as any).mockReturnValue({
        success: true,
        message: "Task task_123 stop signal sent",
        task: {
          id: "task_123",
          subSessionId: "sub-123",
          parentSessionId: "parent-123",
          description: "Test task",
          subagentType: "general",
          status: "running",
          createdAt: Date.now() - 60000,
          startedAt: Date.now() - 50000,
        },
      });

      const result = await tool.execute({ task_id: "task_123" }, {});

      expect(result.success).toBe(true);
      expect(result.output).toContain("Task stopped successfully");
      expect(result.output).toContain("task_123");
      expect(result.output).toContain("Test task");
    });

    test("should return failure when task not found", async () => {
      (mockManager.stopTask as any).mockReturnValue({
        success: false,
        message: "Task not found: task_nonexistent",
      });

      const result = await tool.execute({ task_id: "task_nonexistent" }, {});

      expect(result.success).toBe(false);
      expect(result.output).toContain("Task not found");
      expect(result.error).toContain("Task not found");
    });

    test("should return failure when task not running", async () => {
      (mockManager.stopTask as any).mockReturnValue({
        success: false,
        message: "Task is not running (current status: completed)",
        task: {
          id: "task_123",
          subSessionId: "sub-123",
          parentSessionId: "parent-123",
          description: "Completed task",
          subagentType: "general",
          status: "completed",
          createdAt: Date.now() - 60000,
          startedAt: Date.now() - 50000,
          completedAt: Date.now() - 10000,
        },
      });

      const result = await tool.execute({ task_id: "task_123" }, {});

      expect(result.success).toBe(false);
      expect(result.output).toContain("Cannot stop task");
      expect(result.output).toContain("completed");
    });

    test("should include elapsed time in output", async () => {
      const startedAt = Date.now() - 125000; // 2m 5s ago
      (mockManager.stopTask as any).mockReturnValue({
        success: true,
        message: "Task stopped",
        task: {
          id: "task_123",
          subSessionId: "sub-123",
          parentSessionId: "parent-123",
          description: "Test task",
          subagentType: "general",
          status: "running",
          createdAt: startedAt - 5000,
          startedAt,
        },
      });

      const result = await tool.execute({ task_id: "task_123" }, {});

      expect(result.success).toBe(true);
      expect(result.output).toContain("Elapsed Time:");
      expect(result.output).toContain("2m");
    });

    test("should include task_id in metadata", async () => {
      (mockManager.stopTask as any).mockReturnValue({
        success: true,
        message: "Task stopped",
        task: {
          id: "task_123",
          subSessionId: "sub-123",
          parentSessionId: "parent-123",
          description: "Test task",
          subagentType: "general",
          status: "running",
          createdAt: Date.now(),
          startedAt: Date.now(),
        },
      });

      const result = await tool.execute({ task_id: "task_123" }, {});

      expect(result.metadata?.task_id).toBe("task_123");
    });
  });
});
