export type EventRole = "user" | "assistant" | "system" | "tool" | "agent";

export interface Event {
  event_type: string;
  timestamp: string;
  role: EventRole;
  content: string | Record<string, unknown>;
  event_id?: string;
  message_id?: string;
  name?: string;
  attachments?: Attachment[];
  metadata?: Record<string, unknown>;
}

export interface Attachment {
  type: string;
  url: string;
  name?: string;
}

export const EventTypes = {
  USER_QUERY: "user_query",
  SESSION_CREATED: "session.created",
  SESSION_UPDATED: "session.updated",
  SESSION_DELETED: "session.deleted",
  BACKGROUND_TASK_COMPLETED: "background_task.completed",
  BACKGROUND_TASK_FAILED: "background_task.failed",
  BACKGROUND_TASK_PROGRESS: "background_task.progress",
  BACKGROUND_TASK_TIMEOUT: "background_task.timeout",
  BACKGROUND_TASK_STOPPED: "background_task.stopped",
  ENVIRONMENT_SWITCHED: "environment.switched",
  TOOL_EXECUTED: "tool.executed",
  TOOL_ERROR: "tool.error",
  STREAM_START: "stream.start",
  STREAM_TEXT: "stream.text",
  STREAM_COMPLETED: "stream.completed",
  STREAM_ERROR: "stream.error",
} as const;

export interface EnvEvent<T = unknown> {
  id: string;
  type: string;
  timestamp: number;
  metadata: {
    trigger_session_id?: string;
    trigger_agent_id?: string;
    trigger_agent_name?: string;
    env_name?: string;
    source?: string;
    [key: string]: unknown;
  };
  payload: T;
}
