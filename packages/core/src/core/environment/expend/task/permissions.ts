import type { SessionPermission, SubAgentSpec } from "./types.js";

export interface PermissionOptions {
  extraPermissions?: SessionPermission[];
}

export function buildSubAgentPermissions(
  subAgent: SubAgentSpec | undefined,
  options: PermissionOptions = {}
): SessionPermission[] {
  const permissions: SessionPermission[] = [
    { permission: "todowrite", pattern: "*", action: "deny" },
    { permission: "todoread", pattern: "*", action: "deny" },
    { permission: "task", pattern: "*", action: "deny" },
  ];

  if (subAgent?.allowedTools && subAgent.allowedTools.length > 0) {
    permissions.push({ permission: "*", pattern: "*", action: "deny" });
    for (const tool of subAgent.allowedTools) {
      permissions.push({ permission: "tool", pattern: tool, action: "allow" });
    }
  }

  if (subAgent?.deniedTools) {
    for (const tool of subAgent.deniedTools) {
      permissions.push({ permission: "tool", pattern: tool, action: "deny" });
    }
  }

  return [...permissions, ...(options.extraPermissions || [])];
}

export function getDefaultSubAgentPrompt(taskDescription: string): string {
  return `You are a subagent created by the main agent to handle a specific task.

## Your Role
- You were created to handle: ${taskDescription}
- Complete this task. That's your entire purpose.
- You are NOT the main agent. Don't try to be.

## Rules
1. **Stay focused** - Do your assigned task, nothing else
2. **Complete the task** - Your final message will be automatically reported to the main agent
3. **Don't initiate** - No heartbeats, no proactive actions, no side quests
4. **Be ephemeral** - You may be terminated after task completion. That's fine.

## Execution
- Use the available tools to complete the task
- If you need more information, ask the main agent through the result
- Return a clear summary of what you did and the results`;
}
