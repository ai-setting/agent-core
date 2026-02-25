/**
 * @fileoverview Integration tests for background task progress notification to main session.
 * 
 * Tests the flow:
 * 1. Background task is created with parent session
 * 2. Progress events are published periodically (every 2 minutes)
 * 3. Events contain correct trigger_session_id to route to main session
 * 4. Main session can receive and process these events
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "bun:test";
import { BackgroundTaskManager } from "./background-task-manager.js";
import { EventTypes } from "../../../types/event.js";

describe("Background Task Progress Notification to Main Session", () => {
  let manager: BackgroundTaskManager;
  let mockEnv: any;
  let publishedEvents: any[];
  let mockSubSession: any;
  let mockParentSession: any;

  beforeEach(() => {
    publishedEvents = [];
    
    mockParentSession = {
      id: "main-session-123",
      info: { metadata: {} },
      addMessage: vi.fn(),
      addUserMessage: vi.fn(),
      addAssistantMessage: vi.fn(),
      toHistory: vi.fn().mockReturnValue([]),
    };

    mockSubSession = {
      id: "sub-session-456",
      info: { metadata: { subagent_type: "general" } },
      addMessage: vi.fn(),
      addUserMessage: vi.fn(),
      addAssistantMessage: vi.fn(),
      toHistory: vi.fn().mockReturnValue([]),
    };

    mockEnv = {
      getSession: vi.fn().mockImplementation((id: string) => {
        if (id === "main-session-123") return mockParentSession;
        if (id === "sub-session-456") return mockSubSession;
        return null;
      }),
      createSession: vi.fn().mockReturnValue(mockSubSession),
      handle_query: vi.fn(),
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

  describe("Event Routing to Main Session", () => {
    test("completion event should route to main session", async () => {
        mockEnv.handle_query = vi.fn().mockResolvedValue("Task completed with result: success");

        const result = await manager.createTask({
          parentSessionId: "main-session-123",
          description: "Test task",
          prompt: "Do work",
          subagentType: "general",
        });

        await new Promise(r => setTimeout(r, 200));

        const completedEvents = publishedEvents.filter(
          e => e.type === EventTypes.BACKGROUND_TASK_COMPLETED
        );

        expect(completedEvents.length).toBeGreaterThan(0);
        
        const completedEvent = completedEvents[0];
        expect(completedEvent.metadata.trigger_session_id).toBe("main-session-123");
        expect(completedEvent.metadata.task_id).toBe(result.taskId);
        expect(completedEvent.payload.result).toContain("success");
      });

    test("timeout event should route to main session with correct info", async () => {
        mockEnv.handle_query = vi.fn().mockImplementation(async () => {
          await new Promise(r => setTimeout(r, 10000));
          return "Should not reach here";
        });

        const result = await manager.createTask({
          parentSessionId: "main-session-123",
          description: "Timeout test task",
          prompt: "Long work",
          subagentType: "general",
          timeout: 100,
        });

        await new Promise(r => setTimeout(r, 200));

        const timeoutEvents = publishedEvents.filter(
          e => e.type === EventTypes.BACKGROUND_TASK_TIMEOUT
        );

        expect(timeoutEvents.length).toBeGreaterThan(0);
        
        const timeoutEvent = timeoutEvents[0];
        expect(timeoutEvent.metadata.trigger_session_id).toBe("main-session-123");
        expect(timeoutEvent.payload.description).toBe("Timeout test task");
        expect(timeoutEvent.payload.message).toContain("超时");
      });

      test("failure event should route to main session", async () => {
        mockEnv.handle_query = vi.fn().mockRejectedValue(new Error("Task failed"));

        await manager.createTask({
          parentSessionId: "main-session-123",
          description: "Failing task",
          prompt: "Do work",
          subagentType: "general",
        });

        await new Promise(r => setTimeout(r, 200));

        const failedEvents = publishedEvents.filter(
          e => e.type === EventTypes.BACKGROUND_TASK_FAILED
        );

        expect(failedEvents.length).toBeGreaterThan(0);
        
        const failedEvent = failedEvents[0];
        expect(failedEvent.metadata.trigger_session_id).toBe("main-session-123");
        expect(failedEvent.payload.error).toContain("Task failed");
      });

      test("rate limit error after retries should publish failure event", async () => {
        const rateLimitError = new Error('API error: 429 - {"type":"error","error":{"type":"FreeUsageLimitError","message":"Rate limit exceeded. Please try again later."}}');
        
        let callCount = 0;
        mockEnv.handle_query = vi.fn().mockImplementation(async () => {
          callCount++;
          throw rateLimitError;
        });

        await manager.createTask({
          parentSessionId: "main-session-123",
          description: "Rate limited task",
          prompt: "Do work that triggers rate limit",
          subagentType: "general",
        });

        await new Promise(r => setTimeout(r, 500));

        const failedEvents = publishedEvents.filter(
          e => e.type === EventTypes.BACKGROUND_TASK_FAILED
        );

        expect(failedEvents.length).toBeGreaterThan(0);
        
        const failedEvent = failedEvents[0];
        expect(failedEvent.metadata.trigger_session_id).toBe("main-session-123");
        expect(failedEvent.payload.description).toBe("Rate limited task");
        expect(failedEvent.payload.error).toContain("429");
        expect(failedEvent.payload.error).toContain("Rate limit");
        expect(failedEvent.payload.subagentType).toBe("general");
        expect(failedEvent.payload.execution_time_ms).toBeDefined();
        
        expect(callCount).toBeGreaterThanOrEqual(1);
      });

      test("max retries exceeded should publish failure event", async () => {
        const maxRetriesError = new Error('Max error retries (3) exceeded. Last error: API error: 429 - Rate limit exceeded');
        
        mockEnv.handle_query = vi.fn().mockRejectedValue(maxRetriesError);

        await manager.createTask({
          parentSessionId: "main-session-123",
          description: "Task with max retries exceeded",
          prompt: "Do work",
          subagentType: "general",
        });

        await new Promise(r => setTimeout(r, 200));

        const failedEvents = publishedEvents.filter(
          e => e.type === EventTypes.BACKGROUND_TASK_FAILED
        );

        expect(failedEvents.length).toBeGreaterThan(0);
        
        const failedEvent = failedEvents[0];
        expect(failedEvent.metadata.trigger_session_id).toBe("main-session-123");
        expect(failedEvent.payload.error).toContain("Max error retries");
        expect(failedEvent.payload.error).toContain("429");
      });
   });

  describe("Event Payload Structure", () => {
    test("all event types should have consistent structure", async () => {
        mockEnv.handle_query = vi.fn().mockResolvedValue("Done");

        const result = await manager.createTask({
          parentSessionId: "main-session-123",
          description: "Structure test",
          prompt: "Work",
          subagentType: "general",
        });

        await new Promise(r => setTimeout(r, 200));

        const allEvents = publishedEvents;
        
        for (const event of allEvents) {
          expect(event.id).toBeDefined();
          expect(event.id.startsWith("evt_")).toBe(true);
          expect(event.type).toBeDefined();
          expect(event.timestamp).toBeDefined();
          expect(event.metadata.trigger_session_id).toBe("main-session-123");
          expect(event.metadata.source).toBe("tool");
          expect(event.metadata.task_id).toBe(result.taskId);
          expect(event.payload).toBeDefined();
        }
      });

    test("completion event should include execution time", async () => {
        mockEnv.handle_query = vi.fn().mockImplementation(async () => {
          await new Promise(r => setTimeout(r, 100));
          return "Done";
        });

        await manager.createTask({
          parentSessionId: "main-session-123",
          description: "Timing test",
          prompt: "Work",
          subagentType: "general",
        });

        await new Promise(r => setTimeout(r, 500));

        const completedEvents = publishedEvents.filter(
          e => e.type === EventTypes.BACKGROUND_TASK_COMPLETED
        );

        expect(completedEvents.length).toBeGreaterThan(0);
        expect(completedEvents[0].payload.execution_time_ms).toBeDefined();
        expect(completedEvents[0].payload.execution_time_ms).toBeGreaterThanOrEqual(100);
      });
  });

  describe("Stopped Task Notification", () => {
    test("stopped event should notify main session with current state", async () => {
        mockEnv.handle_query = vi.fn().mockImplementation(async () => {
          await new Promise(r => setTimeout(r, 10000));
          return new Promise<string>(resolve => {
            setTimeout(() => resolve("done"), 20000);
          });
        });

        const result = await manager.createTask({
          parentSessionId: "main-session-123",
          description: "Stoppable task",
          prompt: "Long work",
          subagentType: "general",
        });

        await new Promise(r => setTimeout(r, 50));

        const stopResult = manager.stopTask(result.taskId);
        expect(stopResult.success).toBe(true);

        await new Promise(r => setTimeout(r, 200));

        const stoppedEvents = publishedEvents.filter(
          e => e.type === EventTypes.BACKGROUND_TASK_STOPPED
        );

        expect(stoppedEvents.length).toBeGreaterThan(0);
        
        const stoppedEvent = stoppedEvents[0];
        expect(stoppedEvent.metadata.trigger_session_id).toBe("main-session-123");
        expect(stoppedEvent.payload.message).toContain("停止");
        expect(stoppedEvent.payload.execution_time_ms).toBeDefined();
      });

      test("stopTask should return task info for UI display", async () => {
        mockEnv.handle_query = vi.fn().mockImplementation(async () => {
          await new Promise(r => setTimeout(r, 10000));
          return "should not complete";
        });

        const result = await manager.createTask({
          parentSessionId: "main-session-123",
          description: "Task to stop",
          prompt: "Work",
          subagentType: "general",
        });

        await new Promise(r => setTimeout(r, 50));

        const stopResult = manager.stopTask(result.taskId);

        expect(stopResult.success).toBe(true);
        expect(stopResult.task).toBeDefined();
        expect(stopResult.task?.description).toBe("Task to stop");
        expect(stopResult.task?.status).toBe("running");
      });
  });

  describe("Task Manager State", () => {
    test("getTask should return current task state", async () => {
        mockEnv.handle_query = vi.fn().mockImplementation(async () => {
          await new Promise(r => setTimeout(r, 1000));
          return "Done";
        });

        const result = await manager.createTask({
          parentSessionId: "main-session-123",
          description: "State test",
          prompt: "Work",
          subagentType: "general",
        });

        await new Promise(r => setTimeout(r, 50));

        const task = manager.getTask(result.taskId);
        expect(task).toBeDefined();
        expect(task?.status).toBe("running");
        expect(task?.description).toBe("State test");
      });

    test("listTasks should filter by parentSessionId", async () => {
        mockEnv.handle_query = vi.fn().mockResolvedValue("Done");

        // Update getSession mock to handle both sessions
        mockEnv.getSession = vi.fn().mockImplementation((id: string) => {
          if (id === "main-session-123" || id === "main-session-789") return mockParentSession;
          if (id === "sub-session-456") return mockSubSession;
          return mockParentSession; // Return parent session as default for sub-sessions
        });

        await manager.createTask({
          parentSessionId: "main-session-123",
          description: "Task 1",
          prompt: "Work",
          subagentType: "general",
        });

        await manager.createTask({
          parentSessionId: "main-session-789",
          description: "Task 2",
          prompt: "Work",
          subagentType: "general",
        });

        await new Promise(r => setTimeout(r, 300));

        const tasksFor123 = manager.listTasks("main-session-123");
        expect(tasksFor123.length).toBe(1);
        expect(tasksFor123[0].description).toBe("Task 1");

        const allTasks = manager.listTasks();
        expect(allTasks.length).toBe(2);
      });
  });

  describe("Sub Session Association", () => {
    test("task should be associated with correct sub session", async () => {
        mockEnv.handle_query = vi.fn().mockResolvedValue("Done");

        const result = await manager.createTask({
          parentSessionId: "main-session-123",
          description: "Sub session test",
          prompt: "Work",
          subagentType: "general",
        });

        await new Promise(r => setTimeout(r, 200));

        const task = manager.getTask(result.taskId);
        expect(task?.subSessionId).toBe("sub-session-456");
        
        const completedEvents = publishedEvents.filter(
          e => e.type === EventTypes.BACKGROUND_TASK_COMPLETED
        );
        expect(completedEvents[0].payload.sub_session_id).toBe("sub-session-456");
      });
  });
});
