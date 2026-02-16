import { z } from "zod";

export const TaskToolParameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string()
    .describe("The type of specialized agent to use for this task (e.g., 'general', 'explore')")
    .default("general"),
  background: z.boolean()
    .describe("Whether to run the task in background. If true, returns immediately and notifies when complete (default: false)")
    .default(false),
  session_id: z.string()
    .describe("Existing session to continue (optional)")
    .optional(),
  command: z.string()
    .describe("The command that triggered this task (optional)")
    .optional(),
  timeout: z.number()
    .describe("Task timeout in milliseconds. If set, task will be terminated after timeout (optional)")
    .optional(),
  cleanup: z.enum(["delete", "keep"] as const)
    .describe("Whether to delete sub session after completion. 'delete' removes the session, 'keep' retains it (default: keep)")
    .default("keep")
    .optional(),
});

export type TaskToolParams = z.infer<typeof TaskToolParameters>;

export interface TaskToolResult {
  success: boolean;
  title: string;
  output: string;
  metadata: {
    sessionId: string;
    subagent_type: string;
    background: boolean;
    execution_time_ms?: number;
    status?: "accepted" | "completed" | "failed";
    sub_session_id?: string;
  };
}

export interface SubAgentSpec {
  id: string;
  name: string;
  description: string;
  mode: "subagent" | "primary" | "all";
  promptOverride?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  maxRetries?: number;
  timeout?: number;
}

export interface BackgroundTask {
  id: string;
  subSessionId: string;
  parentSessionId: string;
  description: string;
  subagentType: string;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

export interface SessionPermission {
  permission: string;
  pattern: string;
  action: "allow" | "deny";
}
