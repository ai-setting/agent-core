/**
 * @fileoverview Unit tests for SubAgentManager.
 */

import { describe, test, expect, vi, beforeEach } from "bun:test";
import { SubAgentManager } from "./subagent-manager.js";
import type { ServerEnvironment } from "../../../../server/environment.js";
import type { Session } from "../../../session/index.js";

// Mock session
function createMockSession(overrides: any = {}): Session {
  return {
    id: "test-session-id",
    info: {
      id: "test-session-id",
      title: "Test Session",
      metadata: {
        subagent_type: "general",
        task_description: "Test task description",
        task_id: 123,
        ...overrides.metadata,
      },
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    },
    addMessageFromModelMessage: vi.fn(),
    toHistory: vi.fn().mockResolvedValue([]),
  } as any;
}

// Mock environment
function createMockEnv(): ServerEnvironment {
  return {
    getSession: vi.fn().mockImplementation((id: string) => createMockSession()),
    createSession: vi.fn().mockImplementation((options: any) => createMockSession(options.metadata ? { metadata: options.metadata } : {})),
  } as any;
}

describe("SubAgentManager - buildFullPrompt", () => {
  let subAgentManager: SubAgentManager;
  let mockEnv: ServerEnvironment;

  beforeEach(() => {
    mockEnv = createMockEnv();
    subAgentManager = new SubAgentManager(mockEnv);
  });

  test("should include task_id in metadata when creating sub-session", async () => {
    const session = await subAgentManager.createSubSession({
      parentSessionId: "parent-session",
      title: "Test Task",
      subagentType: "general",
      description: "Test description",
      taskId: 456,
    });

    expect(session.info.metadata?.task_id).toBe(456);
  });

  test("should include task_description in metadata", async () => {
    const session = await subAgentManager.createSubSession({
      parentSessionId: "parent-session",
      title: "Test Task",
      subagentType: "general",
      description: "My test task",
    });

    expect(session.info.metadata?.task_description).toBe("My test task");
  });

  test("should include subagent_type in metadata", async () => {
    const session = await subAgentManager.createSubSession({
      parentSessionId: "parent-session",
      title: "Test Task",
      subagentType: "explore",
    });

    expect(session.info.metadata?.subagent_type).toBe("explore");
  });

  test("should handle missing task_id gracefully", async () => {
    // Create mock session without task_id in metadata
    const mockEnvWithoutTaskId = {
      getSession: vi.fn().mockImplementation((id: string) => ({
        id: "test-session-id",
        info: {
          id: "test-session-id",
          title: "Test Session",
          metadata: {
            subagent_type: "general",
            task_description: "Test task description",
            // No task_id here
          },
          time: { created: Date.now(), updated: Date.now() },
        },
      })),
      createSession: vi.fn().mockImplementation((options: any) => ({
        id: "new-session-id",
        info: {
          id: "new-session-id",
          title: options.title || "New Session",
          metadata: options.metadata || {},
          time: { created: Date.now(), updated: Date.now() },
        },
      })),
    } as any;

    const manager = new SubAgentManager(mockEnvWithoutTaskId);
    const session = await manager.createSubSession({
      parentSessionId: "parent",
      title: "Test",
      subagentType: "general",
      // No taskId passed
    });

    expect(session.info.metadata?.task_id).toBeUndefined();
  });
});

describe("SubAgentManager - CreateSubSession Options", () => {
  test("should accept taskId in CreateSubSessionOptions", async () => {
    const mockEnv = createMockEnv();
    const manager = new SubAgentManager(mockEnv);

    const session = await manager.createSubSession({
      parentSessionId: "parent",
      title: "Test",
      subagentType: "general",
      taskId: 999,
    });

    expect((session.info.metadata as any)?.task_id).toBe(999);
  });
});
