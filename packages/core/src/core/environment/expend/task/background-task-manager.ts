import { EventTypes } from "../../../../core/types/event.js";
import type { ServerEnvironment } from "../../../../server/environment.js";
import type { Session } from "../../../session/index.js";
import type { BackgroundTask } from "./types.js";
import { SubAgentManager } from "./subagent-manager.js";
import { createLogger } from "../../../../utils/logger.js";
import { sessionAbortManager } from "../../../session/abort-manager.js";

const logger = createLogger("background:task", "server.log");

export interface CreateBackgroundTaskOptions {
  parentSessionId: string;
  description: string;
  prompt: string;
  subagentType: string;
  timeout?: number;
  cleanup?: "delete" | "keep";
}

const DEFAULT_TIMEOUT = 900000; // 15 minutes
const PROGRESS_INTERVAL = 120000; // 2 minutes

export class BackgroundTaskManager {
  private tasks: Map<string, BackgroundTask> = new Map();
  private subAgentManager: SubAgentManager;
  private progressTimers: Map<string, NodeJS.Timeout> = new Map();
  private abortControllers: Map<string, AbortController> = new Map();

  constructor(private env: ServerEnvironment) {
    this.subAgentManager = new SubAgentManager(env);
  }

  async createTask(options: CreateBackgroundTaskOptions): Promise<{ taskId: string; subSessionId: string }> {
    const { parentSessionId, description, prompt, subagentType, timeout, cleanup } = options;

    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    
    logger.info(`[BackgroundTaskManager] Creating task`, {
      taskId,
      parentSessionId,
      description,
      subagentType,
      timeout: timeout || DEFAULT_TIMEOUT
    });
    
    const subSession = await this.subAgentManager.createSubSession({
      parentSessionId,
      title: description,
      subagentType,
      description: description,
    });

    const abortController = new AbortController();

    const task: BackgroundTask = {
      id: taskId,
      subSessionId: subSession.id,
      parentSessionId,
      description,
      subagentType,
      status: "pending",
      createdAt: Date.now(),
      abortController,
    };
    this.tasks.set(taskId, task);
    this.abortControllers.set(taskId, abortController);

    logger.info(`[BackgroundTaskManager] Task created, starting execution`, {
      taskId,
      subSessionId: subSession.id
    });

    this.executeTask(taskId, prompt, timeout, cleanup).catch((err) => {
      logger.error(`[BackgroundTaskManager] executeTask unhandled rejection`, {
        taskId,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
    });

    return { taskId, subSessionId: subSession.id };
  }

  private async executeTask(
    taskId: string,
    prompt: string,
    timeout?: number,
    cleanup?: "delete" | "keep"
  ): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      logger.warn(`[BackgroundTaskManager] executeTask: Task not found`, { taskId });
      return;
    }

    task.status = "running";
    task.startedAt = Date.now();

    const timeoutMs = timeout || DEFAULT_TIMEOUT;
    const abortController = this.abortControllers.get(taskId);

    logger.info(`[BackgroundTaskManager] Task execution started`, {
      taskId,
      status: "running",
      timeoutMs,
      hasAbortController: !!abortController
    });

    this.startProgressReporter(taskId);

    try {
      const subSession = this.env.getSession(task.subSessionId);
      if (!subSession) {
        throw new Error(`Sub session not found: ${task.subSessionId}`);
      }

      logger.info(`[BackgroundTaskManager] Executing task with handle_query`, {
        taskId,
        subSessionId: task.subSessionId
      });

      const result = await this.executeWithAbort(
        subSession,
        prompt,
        timeoutMs,
        abortController?.signal
      );

      logger.info(`[BackgroundTaskManager] Task execution returned`, {
        taskId,
        aborted: abortController?.signal.aborted,
        resultLength: result?.length
      });

      if (abortController?.signal.aborted) {
        logger.info(`[BackgroundTaskManager] Task was aborted, skipping completion`, { taskId });
        return;
      }

      task.status = "completed";
      task.completedAt = Date.now();
      task.result = result;

      this.stopProgressReporter(taskId);
      await this.publishCompletionEvent(task);

      logger.info(`[BackgroundTaskManager] Task completed successfully`, {
        taskId,
        executionTimeMs: task.completedAt - task.startedAt
      });

    } catch (error) {
      this.stopProgressReporter(taskId);

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[BackgroundTaskManager] Task execution error`, {
        taskId,
        error: errorMessage,
        aborted: abortController?.signal.aborted
      });

      if (errorMessage.includes("timeout")) {
        task.status = "timeout";
        task.completedAt = Date.now();
        task.error = errorMessage;
        await this.publishTimeoutEvent(task);
        logger.info(`[BackgroundTaskManager] Task marked as timeout`, { taskId });
      } else if (abortController?.signal.aborted) {
        task.status = "stopped";
        task.completedAt = Date.now();
        await this.publishStoppedEvent(task);
        logger.info(`[BackgroundTaskManager] Task marked as stopped`, { taskId });
      } else {
        task.status = "failed";
        task.completedAt = Date.now();
        task.error = errorMessage;
        await this.publishFailureEvent(task);
        logger.info(`[BackgroundTaskManager] Task marked as failed`, { taskId });
      }
    } finally {
      if (cleanup === "delete") {
        this.env.deleteSession(task.subSessionId);
        this.tasks.delete(taskId);
      }
      this.abortControllers.delete(taskId);
      logger.info(`[BackgroundTaskManager] Task cleanup completed`, {
        taskId,
        finalStatus: task.status,
        cleanup,
        taskRemoved: cleanup === "delete"
      });
    }
  }

  private async executeWithAbort(
    subSession: Session,
    prompt: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      if (signal) {
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("Task stopped by user"));
        });
      }

      const history = subSession.toHistory();
      logger.info(`executeWithAbort: history length=${history.length}`);
      for (let i = 0; i < history.length; i++) {
        const msg = history[i];
        logger.info(`  history[${i}]: role=${msg.role}, content type=${typeof msg.content}, isArray=${Array.isArray(msg.content)}`);
      }

      this.env.handle_query(prompt, { 
        session_id: subSession.id,
        onMessageAdded: (message: any) => {
          subSession.addMessageFromModelMessage(message);
        }
      }, subSession.toHistory())
      .then((result) => {
        clearTimeout(timer);
        logger.info(`handle_query success, result length: ${result.length}`);
        resolve(result);
      })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  private startProgressReporter(taskId: string): void {
    const timer = setInterval(() => {
      const task = this.tasks.get(taskId);
      if (!task || task.status !== "running") {
        this.stopProgressReporter(taskId);
        return;
      }

      const elapsedMs = Date.now() - (task.startedAt || task.createdAt);
      this.publishProgressEvent(task, elapsedMs);
    }, PROGRESS_INTERVAL);

    this.progressTimers.set(taskId, timer);
  }

  private stopProgressReporter(taskId: string): void {
    const timer = this.progressTimers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.progressTimers.delete(taskId);
    }
  }

  private async publishProgressEvent(task: BackgroundTask, elapsedMs: number): Promise<void> {
    await this.env.publishEvent({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      type: EventTypes.BACKGROUND_TASK_PROGRESS,
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
        elapsed_time_ms: elapsedMs,
        elapsed_time_human: this.formatDuration(elapsedMs),
      },
    });
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

  private async publishTimeoutEvent(task: BackgroundTask): Promise<void> {
    await this.env.publishEvent({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      type: EventTypes.BACKGROUND_TASK_TIMEOUT,
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
        execution_time_ms: task.completedAt! - task.startedAt!,
        message: `任务执行超时，已暂停。可通过 task_id: ${task.id} 查看当前状态。`,
      },
    });
  }

  private async publishStoppedEvent(task: BackgroundTask): Promise<void> {
    await this.env.publishEvent({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      type: EventTypes.BACKGROUND_TASK_STOPPED,
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
        execution_time_ms: task.completedAt! - task.startedAt!,
        message: `任务已被用户停止。`,
      },
    });
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  stopTask(taskId: string): { success: boolean; message: string; task?: BackgroundTask } {
    logger.info(`[BackgroundTaskManager] stopTask called`, { taskId });

    const task = this.tasks.get(taskId);
    if (!task) {
      logger.warn(`[BackgroundTaskManager] stopTask: Task not found`, { taskId });
      return { success: false, message: `Task not found: ${taskId}` };
    }

    logger.info(`[BackgroundTaskManager] stopTask: Task found`, {
      taskId,
      currentStatus: task.status,
      subSessionId: task.subSessionId,
      hasAbortController: this.abortControllers.has(taskId)
    });

    if (task.status !== "running" && task.status !== "pending") {
      logger.warn(`[BackgroundTaskManager] stopTask: Task is not running`, {
        taskId,
        status: task.status
      });
      return { 
        success: false, 
        message: `Task is not running (current status: ${task.status})`,
        task 
      };
    }

    sessionAbortManager.abort(task.subSessionId);
    logger.info(`[BackgroundTaskManager] stopTask: Aborted sub-session`, {
      taskId,
      subSessionId: task.subSessionId
    });

    const abortController = this.abortControllers.get(taskId);
    if (abortController) {
      logger.info(`[BackgroundTaskManager] stopTask: Aborting task`, {
        taskId,
        signalAborted: abortController.signal.aborted
      });
      
      abortController.abort();
      this.stopProgressReporter(taskId);
      
      logger.info(`[BackgroundTaskManager] stopTask: Abort signal sent, progress reporter stopped`, {
        taskId,
        signalAbortedAfter: abortController.signal.aborted
      });
      
      return { 
        success: true, 
        message: `Task ${taskId} stop signal sent`,
        task 
      };
    }

    logger.warn(`[BackgroundTaskManager] stopTask: No abort controller found`, { taskId });
    return { success: false, message: `No abort controller found for task: ${taskId}` };
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
