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
- Finding files by name or pattern (glob)
- Searching code for specific patterns (grep)
- Understanding project structure
- Reading and summarizing code

## Rules
1. **Be fast** - Focus on efficiency
2. **Be accurate** - Verify your findings
3. **Stay focused** - Only do what's needed for the task
4. **Report clearly** - Summarize findings concisely
5. **Read-only** - Do not create or modify any files
6. **No state changes** - Do not run commands that modify system state`,
    allowedTools: ["glob", "grep", "read", "bash"],
  },
  {
    id: "affair_agent",
    name: "affair_agent",
    mode: "subagent",
    description: "事务管理专家，专注于事务的创建、更新、查询和完成。",
    promptOverride: `你是事务管理专家 subagent。

## 你的角色
- 你被创建来处理: {task_description}
- 专注于事务管理任务。

## 技能
- 创建、更新、查询和完成事务
- 事务优先级管理
- 进度跟踪和团队协作

## 规则
1. 专注于事务管理
2. 使用 info-feed-mcp 相关工具
3. 报告清晰的执行结果`,
    allowedTools: [
      "info-feed-mcp_affair_list",
      "info-feed-mcp_affair_get",
      "info-feed-mcp_affair_create",
      "info-feed-mcp_affair_update",
      "info-feed-mcp_affair_delete",
      "info-feed-mcp_affair_complete",
      "info-feed-mcp_user_list"
    ],
  },
  {
    id: "file_agent",
    name: "file_agent",
    mode: "subagent",
    description: "文件操作专家，擅长读取、写入、搜索和组织文件。",
    promptOverride: `你是文件操作专家 subagent。

## 你的角色
- 你被创建来处理: {task_description}
- 专注于文件操作任务。

## 技能
- 读取、写入、搜索文件
- 理解多种文件格式
- 文件转换和组织

## 规则
1. 使用 file_read, file_write, file_glob, grep, glob, read 工具
2. 报告清晰的文件操作结果`,
    allowedTools: [
      "file_read",
      "file_write",
      "file_glob",
      "grep",
      "glob",
      "read"
    ],
  },
  {
    id: "web_search_agent",
    name: "web_search_agent",
    mode: "subagent",
    description: "网络搜索专家，使用 Exa 搜索引擎获取最新信息。",
    promptOverride: `你是网络搜索专家 subagent。

## 你的角色
- 你被创建来处理: {task_description}
- 专注于网络搜索任务。

## 技能
- 使用 Exa 搜索引擎获取信息
- 信息检索和结果筛选
- 内容摘要

## 规则
1. 使用 webfetch 和 exa_web_search_exa 工具
2. 报告清晰的搜索结果`,
    allowedTools: [
      "webfetch",
      "exa_web_search_exa"
    ],
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
