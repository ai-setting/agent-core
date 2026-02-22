/**
 * @fileoverview Unit tests for BackgroundTaskManager.
 */

import { describe, test, expect, beforeEach, vi, afterEach } from "bun:test";
import { BackgroundTaskManager } from "./background-task-manager.js";
import { EventTypes } from "../../../types/event.js";

describe("BackgroundTaskManager", () => {
  let manager: BackgroundTaskManager;
  let mockEnv: any;
  let publishedEvents: any[];

  beforeEach(() => {
    publishedEvents = [];
    
    mockEnv = {
      getSession: vi.fn().mockReturnValue({
        id: "test-sub-session",
        info: { metadata: { subagent_type: "general" } },
        addMessage: vi.fn(),
        addUserMessage: vi.fn(),
        addAssistantMessage: vi.fn(),
        toHistory: vi.fn().mockReturnValue([]),
      }),
      createSession: vi.fn().mockReturnValue({
        id: "test-sub-session",
        info: { metadata: {} },
        addMessage: vi.fn(),
        addUserMessage: vi.fn(),
        addAssistantMessage: vi.fn(),
        toHistory: vi.fn().mockReturnValue([]),
      }),
      handle_query: vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return "Task completed";
      }),
      publishEvent: vi.fn().mockImplementation(async (event: any) => {
        publishedEvents.push(event);
      }),
      deleteSession: vi.fn(),
    };

    manager = new BackgroundTaskManager(mockEnv);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("createTask", () => {
    test("should create a background task with correct properties", async () => {
      const result = await manager.createTask({
        parentSessionId: "parent-123",
        description: "Test task",
        prompt: "Do something",
        subagentType: "general",
      });

      expect(result.taskId).toBeDefined();
      expect(result.taskId.startsWith("task_")).toBe(true);
      expect(result.subSessionId).toBe("test-sub-session");
    });

    test("should create task in pending status initially", async () => {
      const result = await manager.createTask({
        parentSessionId: "parent-123",
        description: "Test task",
        prompt: "Do something",
        subagentType: "general",
      });

      const task = manager.getTask(result.taskId);
      expect(task).toBeDefined();
      expect(task?.status).toBe("running");
    });
  });

  describe("getTask", () => {
    test("should return undefined for non-existent task", () => {
      const task = manager.getTask("non-existent");
      expect(task).toBeUndefined();
    });

    test("should return task after creation", async () => {
      const result = await manager.createTask({
        parentSessionId: "parent-123",
        description: "Test task",
        prompt: "Do something",
        subagentType: "general",
      });

      const task = manager.getTask(result.taskId);
      expect(task).toBeDefined();
      expect(task?.description).toBe("Test task");
    });
  });

  describe("listTasks", () => {
    test("should return empty array when no tasks", () => {
      const tasks = manager.listTasks();
      expect(tasks).toHaveLength(0);
    });

    test("should filter tasks by parentSessionId", async () => {
      await manager.createTask({
        parentSessionId: "parent-1",
        description: "Task 1",
        prompt: "Do something",
        subagentType: "general",
      });

      await manager.createTask({
        parentSessionId: "parent-2",
        description: "Task 2",
        prompt: "Do something",
        subagentType: "general",
      });

      const tasks1 = manager.listTasks("parent-1");
      expect(tasks1).toHaveLength(1);
      expect(tasks1[0].description).toBe("Task 1");

      const tasks2 = manager.listTasks("parent-2");
      expect(tasks2).toHaveLength(1);
      expect(tasks2[0].description).toBe("Task 2");
    });
  });

  describe("stopTask", () => {
    test("should return error for non-existent task", () => {
      const result = manager.stopTask("non-existent");
      expect(result.success).toBe(false);
      expect(result.message).toContain("Task not found");
    });

    test("should return error for completed task", async () => {
      mockEnv.handle_query = vi.fn().mockResolvedValue("Done");
      
      const result = await manager.createTask({
        parentSessionId: "parent-123",
        description: "Test task",
        prompt: "Do something",
        subagentType: "general",
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      const stopResult = manager.stopTask(result.taskId);
      expect(stopResult.success).toBe(false);
      expect(stopResult.message).toContain("Task is not running");
    });

    test("should successfully stop running task", async () => {
      mockEnv.handle_query = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10000));
        return "Done";
      });

      const result = await manager.createTask({
        parentSessionId: "parent-123",
        description: "Long task",
        prompt: "Do something long",
        subagentType: "general",
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const stopResult = manager.stopTask(result.taskId);
      expect(stopResult.success).toBe(true);
      expect(stopResult.message).toContain("stop signal sent");
    });
  });

  describe("Progress Events", () => {
    test("should publish completion event when task succeeds", async () => {
      mockEnv.handle_query = vi.fn().mockResolvedValue("Task completed successfully");

      await manager.createTask({
        parentSessionId: "parent-123",
        description: "Test task",
        prompt: "Do something",
        subagentType: "general",
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      const completedEvents = publishedEvents.filter(
        e => e.type === EventTypes.BACKGROUND_TASK_COMPLETED
      );
      expect(completedEvents.length).toBeGreaterThan(0);
    });

    test("should publish failure event when task fails", async () => {
      mockEnv.handle_query = vi.fn().mockRejectedValue(new Error("Task failed"));

      await manager.createTask({
        parentSessionId: "parent-123",
        description: "Test task",
        prompt: "Do something",
        subagentType: "general",
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      const failedEvents = publishedEvents.filter(
        e => e.type === EventTypes.BACKGROUND_TASK_FAILED
      );
      expect(failedEvents.length).toBeGreaterThan(0);
      expect(failedEvents[0].payload.error).toContain("Task failed");
    });

    test("should publish stopped event when task is stopped", async () => {
      mockEnv.handle_query = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10000));
        return "Done";
      });

      const result = await manager.createTask({
        parentSessionId: "parent-123",
        description: "Long task",
        prompt: "Do something",
        subagentType: "general",
      });

      await new Promise(resolve => setTimeout(resolve, 50));
      manager.stopTask(result.taskId);
      await new Promise(resolve => setTimeout(resolve, 200));

      const stoppedEvents = publishedEvents.filter(
        e => e.type === EventTypes.BACKGROUND_TASK_STOPPED
      );
      expect(stoppedEvents.length).toBeGreaterThan(0);
    });
  });

  describe("Event Metadata", () => {
    test("should include correct metadata in completion event", async () => {
      mockEnv.handle_query = vi.fn().mockResolvedValue("Done");

      const result = await manager.createTask({
        parentSessionId: "parent-123",
        description: "Test task",
        prompt: "Do something",
        subagentType: "general",
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      const completedEvent = publishedEvents.find(
        e => e.type === EventTypes.BACKGROUND_TASK_COMPLETED
      );
      
      expect(completedEvent).toBeDefined();
      expect(completedEvent?.metadata.trigger_session_id).toBe("parent-123");
      expect(completedEvent?.metadata.task_id).toBe(result.taskId);
      expect(completedEvent?.payload.description).toBe("Test task");
      expect(completedEvent?.payload.result).toBe("Done");
    });
  });
});
