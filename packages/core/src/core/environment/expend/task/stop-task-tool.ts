import { z } from "zod";
import type { ToolInfo, ToolContext, ToolResult } from "../../../types/tool.js";
import type { BackgroundTaskManager } from "./background-task-manager.js";

const StopTaskToolParameters = z.object({
  task_id: z.string()
    .describe("The ID of the background task to stop"),
});

type StopTaskToolParams = z.infer<typeof StopTaskToolParameters>;

const STOP_TASK_DESCRIPTION = `Stop a running background task.

Use this tool to stop a background task that is currently running. This is useful when:
- The user wants to cancel a long-running task
- The task is taking too long and needs to be stopped
- The user wants to change direction and doesn't need the task result anymore

When stopped, the task will be terminated immediately and you will receive a confirmation.

Parameters:
- task_id: The ID of the background task to stop (obtained from the task tool response)`;

export function createStopTaskTool(taskManager: BackgroundTaskManager): ToolInfo {
  return {
    name: "stop_task",
    description: STOP_TASK_DESCRIPTION,
    parameters: StopTaskToolParameters,
    execute: async (args: StopTaskToolParams, ctx: ToolContext): Promise<ToolResult> => {
      const startTime = Date.now();
      const { task_id } = args;

      const result = taskManager.stopTask(task_id);

      if (result.success) {
        const task = result.task!;
        const elapsedMs = task.startedAt 
          ? Date.now() - task.startedAt 
          : Date.now() - task.createdAt;

        const output = [
          `✅ Task stopped successfully`,
          "",
          `📋 Task ID: ${task_id}`,
          `📝 Description: ${task.description}`,
          `🔄 Status: ${task.status} → stopped`,
          `⏱️ Elapsed Time: ${formatDuration(elapsedMs)}`,
          "",
          result.message,
        ].join("\n");

        return {
          success: true,
          output,
          metadata: {
            execution_time_ms: Date.now() - startTime,
            task_id,
            previous_status: task.status,
          },
        };
      } else {
        const task = result.task;
        let output: string;

        if (task) {
          output = [
            `⚠️ Cannot stop task`,
            "",
            `📋 Task ID: ${task_id}`,
            `📝 Description: ${task.description}`,
            `🔄 Current Status: ${task.status}`,
            "",
            result.message,
          ].join("\n");
        } else {
          output = [
            `❌ Task not found`,
            "",
            `📋 Task ID: ${task_id}`,
            "",
            result.message,
          ].join("\n");
        }

        return {
          success: false,
          output,
          error: result.message,
          metadata: {
            execution_time_ms: Date.now() - startTime,
            task_id,
          },
        };
      }
    },
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
