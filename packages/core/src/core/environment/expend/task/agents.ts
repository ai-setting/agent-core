import type { SubAgentSpec } from "./types.js";

export const builtInSubAgents: SubAgentSpec[] = [
  {
    id: "general",
    name: "general",
    mode: "subagent",
    description: "General-purpose agent for researching complex questions and executing multi-step tasks.",
    promptOverride: `You are a subagent created by the main agent to handle a specific task.

## Your Role
- You were created to handle: {task_description}
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
- Return a clear summary of what you did and the results`,
  },
  {
    id: "explore",
    name: "explore",
    mode: "subagent",
    description: "Fast agent specialized for exploring codebases, finding files, and searching for patterns.",
    promptOverride: `You are a subagent specialized in fast code exploration.

## Your Role
- You were created to handle: {task_description}
- Complete this task as quickly and accurately as possible.
- You are NOT the main agent. Don't try to be.

## Expertise
- Finding files by name or pattern
- Searching code for specific patterns
- Understanding project structure
- Reading and summarizing code

## Rules
1. **Be fast** - Focus on efficiency
2. **Be accurate** - Verify your findings
3. **Stay focused** - Only do what's needed for the task
4. **Report clearly** - Summarize findings concisely`,
  },
];

export function getSubAgentSpec(id: string): SubAgentSpec | undefined {
  return builtInSubAgents.find(agent => agent.id === id);
}

export function listSubAgents(): SubAgentSpec[] {
  return [...builtInSubAgents];
}

export function getSubAgentToolDescription(): string {
  return builtInSubAgents
    .map(agent => `- ${agent.id}: ${agent.description}`)
    .join("\n");
}
