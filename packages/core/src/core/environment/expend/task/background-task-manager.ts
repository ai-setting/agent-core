import { EventTypes } from "../../../../core/types/event.js";
import type { ServerEnvironment } from "../../../../server/environment.js";
import type { Session } from "../../../session/index.js";
import type { BackgroundTask } from "./types.js";
import { SubAgentManager } from "./subagent-manager.js";

export interface CreateBackgroundTaskOptions {
  parentSessionId: string;
  description: string;
  prompt: string;
  subagentType: string;
  timeout?: number;
  cleanup?: "delete" | "keep";
}

export class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private subAgentManager: SubAgentManager;

  constructor(private env: ServerEnvironment) {
    this.subAgentManager = new SubAgentManager(env);
  }

  async createTask(options: CreateBackgroundTaskOptions): Promise<{ taskId: string; subSessionId: string }> {
    const { parentSessionId, description, prompt, subagentType, timeout, cleanup } = options;

    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    
    const subSession = await this.subAgentManager.createSubSession({
      parentSessionId,
      title: description,
      subagentType,
      description: description,
    });

    const task: BackgroundTask = {
      id: taskId,
      subSessionId: subSession.id,
      parentSessionId,
      description,
      subagentType,
      status: "pending",
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, task);

    this.executeTask(taskId, prompt, timeout, cleanup);

    return { taskId, subSessionId: subSession.id };
  }

  private async executeTask(
    taskId: string,
    prompt: string,
    timeout?: number,
    cleanup?: "delete" | "keep"
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "running";
    task.startedAt = Date.now();

    try {
      const subSession = this.env.getSession(task.subSessionId);
      if (!subSession) {
        throw new Error(`Sub session not found: ${task.subSessionId}`);
      }

      const result = await this.subAgentManager.executeSubSession(
        subSession,
        prompt,
        timeout
      );

      task.status = "completed";
      task.completedAt = Date.now();
      task.result = result;

      await this.publishCompletionEvent(task);

    } catch (error) {
      task.status = "failed";
      task.completedAt = Date.now();
      task.error = error instanceof Error ? error.message : String(error);

      await this.publishFailureEvent(task);
    } finally {
      if (cleanup === "delete") {
        this.env.deleteSession(task.subSessionId);
        this.tasks.delete(taskId);
      }
    }
  }

  private async publishCompletionEvent(task: BackgroundTask): Promise<void> {
    await this.env.publishEvent({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      type: EventTypes.BACKGROUND_TASK_COMPLETED,
      timestamp: Date.now(),
      metadata: {
        trigger_session_id: task.parentSessionId,
        source: "tool",
        task_id: task.id,
      },
      payload: {
        taskId: task.id,
        sub_session_id: task.subSessionId,
        description: task.description,
        subagentType: task.subagentType,
        result: task.result,
        execution_time_ms: task.completedAt! - task.startedAt!,
      },
    });
  }

  private async publishFailureEvent(task: BackgroundTask): Promise<void> {
    await this.env.publishEvent({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      type: EventTypes.BACKGROUND_TASK_FAILED,
      timestamp: Date.now(),
      metadata: {
        trigger_session_id: task.parentSessionId,
        source: "tool",
        task_id: task.id,
      },
      payload: {
        taskId: task.id,
        sub_session_id: task.subSessionId,
        description: task.description,
        subagentType: task.subagentType,
        error: task.error,
        execution_time_ms: task.completedAt! - task.startedAt!,
      },
    });
  }

  getTask(taskId: string): BackgroundTask | undefined {
    return this.tasks.get(taskId);
  }

  listTasks(parentSessionId?: string): BackgroundTask[] {
    const allTasks = Array.from(this.tasks.values());
    if (parentSessionId) {
      return allTasks.filter(t => t.parentSessionId === parentSessionId);
    }
    return allTasks;
  }
}
