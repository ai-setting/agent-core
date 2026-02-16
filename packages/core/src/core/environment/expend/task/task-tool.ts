import { z } from "zod";
import type { ToolInfo, ToolContext, ToolResult } from "../../../types/tool.js";
import type { ServerEnvironment } from "../../../../server/environment.js";
import { TaskToolParameters, type TaskToolParams } from "./types.js";
import { SubAgentManager } from "./subagent-manager.js";
import { BackgroundTaskManager } from "./background-task-manager.js";
import { getSubAgentSpec, getSubAgentToolDescription } from "./agents.js";

export function createTaskTool(env: ServerEnvironment): ToolInfo {
  const subAgentManager = new SubAgentManager(env);
  const backgroundTaskManager = new BackgroundTaskManager(env);

  return {
    name: "task",
    description: `Delegate a task to a subagent for execution.

## Parameters
- **description**: A short (3-5 words) description of the task
- **prompt**: The task for the agent to perform
- **subagent_type**: The type of specialized agent to use for this task (default: "general")
- **background**: Whether to run in background (default: false). If true, returns immediately and notifies when complete.
- **session_id**: Existing session to continue (optional)
- **timeout**: Task timeout in milliseconds (optional)
- **cleanup**: "delete" to remove sub session after completion, "keep" to retain (default: "keep")

## Available SubAgents
${getSubAgentToolDescription()}

## Usage

**Synchronous mode (default)**:
- The tool waits for the subagent to complete and returns the result directly
- Use for quick tasks that need immediate results

**Background mode (background=true)**:
- The tool returns immediately with "accepted" status
- The subagent runs independently in the background
- When complete, the main session is notified via event
- Use for long-running tasks that shouldn't block the main agent

**Result format**:
- Output includes <task_metadata> with session_id for tracking
- Background tasks include task_id for status查询

## Security
- Subagents are denied access to todowrite, todoread, and task tools by default
- Subagents cannot spawn other subagents`,
    parameters: TaskToolParameters,
    execute: async (args: TaskToolParams, ctx: ToolContext): Promise<ToolResult> => {
      const startTime = Date.now();
      const { description, prompt, subagent_type, background, session_id, command, timeout, cleanup } = args;

      const parentSessionId = session_id || ctx.session_id || "default";

      const subAgent = getSubAgentSpec(subagent_type);
      if (!subAgent && subagent_type !== "general") {
        return {
          success: false,
          output: "",
          error: `Unknown subagent type: ${subagent_type}`,
          metadata: {
            execution_time_ms: Date.now() - startTime,
          },
        };
      }

      if (background) {
        return await handleBackgroundTask(
          env,
          backgroundTaskManager,
          parentSessionId,
          description,
          prompt,
          subagent_type,
          timeout,
          cleanup
        );
      } else {
        return await handleSyncTask(
          env,
          subAgentManager,
          parentSessionId,
          description,
          prompt,
          subagent_type,
          timeout
        );
      }
    },
  };
}

async function handleSyncTask(
  env: ServerEnvironment,
  subAgentManager: SubAgentManager,
  parentSessionId: string,
  description: string,
  prompt: string,
  subagentType: string,
  timeout?: number
): Promise<ToolResult> {
  const startTime = Date.now();
  
  try {
    const subSession = await subAgentManager.createSubSession({
      parentSessionId,
      title: description,
      subagentType,
      description: description,
    });

    const result = await subAgentManager.executeSubSession(subSession, prompt, timeout);

    return {
      success: true,
      output: result + "\n\n" + [
        "<task_metadata>",
        `session_id: ${subSession.id}`,
        `subagent_type: ${subagentType}`,
        "</task_metadata>"
      ].join("\n"),
      metadata: {
        execution_time_ms: Date.now() - startTime,
        sessionId: subSession.id,
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
}

async function handleBackgroundTask(
  env: ServerEnvironment,
  backgroundTaskManager: BackgroundTaskManager,
  parentSessionId: string,
  description: string,
  prompt: string,
  subagentType: string,
  timeout?: number,
  cleanup?: "delete" | "keep"
): Promise<ToolResult> {
  const startTime = Date.now();
  
  try {
    const { taskId, subSessionId } = await backgroundTaskManager.createTask({
      parentSessionId,
      description,
      prompt,
      subagentType,
      timeout,
      cleanup: cleanup || "keep",
    });

    const output = [
      `Background task accepted: ${description}`,
      "",
      `A sub-agent session has been created and is running in the background. You will be notified when the task completes.`,
      "",
      `Task ID: ${taskId}`,
      `Session ID: ${subSessionId}`,
      `SubAgent Type: ${subagentType}`,
      "",
      "<task_metadata>",
      `session_id: ${subSessionId}`,
      `task_id: ${taskId}`,
      "status: accepted",
      "</task_metadata>"
    ].join("\n");

    return {
      success: true,
      output,
      metadata: {
        execution_time_ms: Date.now() - startTime,
        sessionId: subSessionId,
        taskId,
        status: "accepted",
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
}
