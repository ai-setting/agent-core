import { z } from "zod";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import type { ToolInfo, ToolContext, ToolResult } from "../../../types/tool.js";
import type { ServerEnvironment } from "../../../../server/environment.js";
import { TaskToolParameters, type TaskToolParams } from "./types.js";
import { SubAgentManager } from "./subagent-manager.js";
import { BackgroundTaskManager } from "./background-task-manager.js";
import { getSubAgentSpec, getSubAgentToolDescription } from "./agents.js";
import { createLogger } from "../../../../utils/logger.js";

const taskToolLogger = createLogger("task:tool", "server.log");

function loadTaskDescription(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const taskTxtPath = join(__dirname, "task.txt");
  try {
    return readFileSync(taskTxtPath, "utf-8");
  } catch {
    return "Task tool for managing background tasks and sub-agents.";
  }
}

function buildTaskDescription(): string {
  const taskDescription = loadTaskDescription();
  const agentsList = getSubAgentToolDescription();
  return taskDescription.replace("{agents}", agentsList);
}

export interface TaskToolResult {
  tool: ToolInfo;
  backgroundTaskManager: BackgroundTaskManager;
}

export function createTaskTool(env: ServerEnvironment): TaskToolResult {
  const subAgentManager = new SubAgentManager(env);
  const backgroundTaskManager = new BackgroundTaskManager(env);

  const tool: ToolInfo = {
    name: "delegate_task",
    description: buildTaskDescription(),
    parameters: TaskToolParameters,
    execute: async (args: TaskToolParams, ctx: ToolContext): Promise<ToolResult> => {
      const startTime = Date.now();
      const { description, prompt, subagent_type = "general", background = false, command, timeout, cleanup, task_id } = args;

      // Validate subagent_type against available agents
      const actualSubagentType = subagent_type;
      
      const parentSessionId = ctx.session_id || "default";
      
// DEBUG `Called with: description=${description}, subagent_type=${subagent_type}, background=${background}, parentSessionId=${parentSessionId}, task_id=${task_id}` // 已精简

      const subAgent = getSubAgentSpec(actualSubagentType);
      if (!subAgent) {
        return {
          success: false,
          output: "",
          error: `Unknown subagent type: ${actualSubagentType}`,
          metadata: {
            execution_time_ms: Date.now() - startTime,
          },
        };
      }

      if (background) {
        taskToolLogger.info(`Starting background task: parentSessionId=${parentSessionId}, subagentType=${actualSubagentType}, task_id=${task_id}`);
        return await handleBackgroundTask(
          env,
          backgroundTaskManager,
          parentSessionId,
          description,
          prompt,
          actualSubagentType,
          timeout,
          cleanup,
          task_id
        );
      } else {
        taskToolLogger.info(`Starting sync task: parentSessionId=${parentSessionId}, subagentType=${actualSubagentType}, task_id=${task_id}`);
        return await handleSyncTask(
          env,
          subAgentManager,
          parentSessionId,
          description,
          prompt,
          actualSubagentType,
          timeout,
          task_id
        );
      }
    },
  };

  return { tool, backgroundTaskManager };
}

async function handleSyncTask(
  env: ServerEnvironment,
  subAgentManager: SubAgentManager,
  parentSessionId: string,
  description: string,
  prompt: string,
  subagentType: string,
  timeout?: number,
  taskId?: number
): Promise<ToolResult> {
  const startTime = Date.now();
  
  try {
    const subSession = await subAgentManager.createSubSession({
      parentSessionId,
      title: description,
      subagentType,
      description: description,
      taskId,
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
  cleanup?: "delete" | "keep",
  taskId?: number
): Promise<ToolResult> {
  const startTime = Date.now();
  
  try {
    const { taskId: bgTaskId, subSessionId } = await backgroundTaskManager.createTask({
      parentSessionId,
      description,
      prompt,
      subagentType,
      timeout,
      cleanup: cleanup || "keep",
      taskId,
    });

    const output = [
      `Background task accepted: ${description}`,
      "",
      `A sub-agent session has been created and is running in the background. You will be notified when the task completes.`,
      "",
      `Task ID: ${bgTaskId}`,
      `Session ID: ${subSessionId}`,
      `SubAgent Type: ${subagentType}`,
      "",
      "<task_metadata>",
      `session_id: ${subSessionId}`,
      `task_id: ${bgTaskId}`,
      "status: accepted",
      "</task_metadata>"
    ].join("\n");

    return {
      success: true,
      output,
      metadata: {
        execution_time_ms: Date.now() - startTime,
        sessionId: subSessionId,
        taskId: bgTaskId,
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
