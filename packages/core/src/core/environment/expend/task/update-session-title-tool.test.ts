/**
 * @fileoverview Unit tests for update_session_title tool.
 */

import { describe, test, expect, vi, beforeEach } from "bun:test";
import { createUpdateSessionTitleTool } from "./update-session-title-tool.js";
import type { ServerEnvironment } from "../../../../server/environment.js";

describe("UpdateSessionTitleTool", () => {
  let mockEnv: ServerEnvironment;
  let updateSessionTool: ReturnType<typeof createUpdateSessionTitleTool>;

  beforeEach(() => {
    mockEnv = {
      getSession: vi.fn().mockImplementation((id: string) => {
        if (id === "existing-session") {
          return {
            id: "existing-session",
            info: { title: "Old Title" },
            updateTitle: vi.fn(),
          } as any;
        }
        return undefined;
      }),
      updateSession: vi.fn(),
    } as any;

    updateSessionTool = createUpdateSessionTitleTool(mockEnv);
  });

  test("should have correct tool name", () => {
    expect(updateSessionTool.tool.name).toBe("update_session_title");
  });

  test("should have required parameters", () => {
    expect(updateSessionTool.tool.parameters.shape.session_id).toBeDefined();
    expect(updateSessionTool.tool.parameters.shape.title).toBeDefined();
    expect(updateSessionTool.tool.parameters.shape.reason).toBeDefined();
  });

  test("should update session title successfully", async () => {
    const result = await updateSessionTool.tool.execute(
      {
        session_id: "existing-session",
        title: "New Session Title",
        reason: "Test update",
      },
      {}
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("New Session Title");
  });

  test("should return error when session not found", async () => {
    const result = await updateSessionTool.tool.execute(
      {
        session_id: "nonexistent-session",
        title: "New Title",
        reason: "Test",
      },
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
