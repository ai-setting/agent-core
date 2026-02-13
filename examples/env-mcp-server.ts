#!/usr/bin/env bun
/**
 * @fileoverview Env MCP Server 示例（与 info_feed_mcp 同构）
 *
 * 使用 MCP SDK：EnvMCPServer + StdioServerTransport，只做 server.connect(transport)。
 * 不手写 stdio/HTTP，启动方式由调用方或配置文件（如 .json 的 command）决定。
 *
 * 用法:
 *   bun run examples/env-mcp-server.ts
 *
 * 或由 MCP 配置启动，例如:
 *   { "command": ["bun", "run", "examples/env-mcp-server.ts"] }
 */

import { EnvMCPServer, StdioServerTransport } from "../packages/core/src/env_spec/server.js";
import type { EnvDescription, EnvProfile, AgentSpec, LogEntry } from "../packages/core/src/env_spec/types.js";

// 模拟的环境数据
const mockEnv: EnvDescription = {
  id: "demo-env",
  displayName: "Demo Environment",
  version: "1.0.0",
  capabilities: {
    logs: true,
    events: true,
    profiles: true,
  },
};

const mockProfiles: EnvProfile[] = [
  {
    id: "default",
    displayName: "Default Profile",
    primaryAgents: [
      {
        id: "coding-assistant",
        role: "primary",
        promptId: "system:coding",
        allowedTools: ["bash", "file_read", "file_write"],
      },
      {
        id: "reviewer",
        role: "sub",
        promptId: "system:review",
        allowedTools: ["file_read"],
      },
    ],
  },
  {
    id: "advanced",
    displayName: "Advanced Profile",
    primaryAgents: [
      {
        id: "architect",
        role: "primary",
        promptId: "system:architect",
        allowedTools: ["bash", "file_read", "file_write", "task"],
      },
    ],
  },
];

const mockLogs: LogEntry[] = [
  {
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    level: "info",
    message: "Environment initialized",
    sessionId: "session-001",
  },
  {
    timestamp: new Date(Date.now() - 1800000).toISOString(),
    level: "info",
    message: "Agent started: coding-assistant",
    sessionId: "session-001",
    agentId: "coding-assistant",
  },
  {
    timestamp: new Date(Date.now() - 900000).toISOString(),
    level: "warn",
    message: "Tool execution timeout: bash",
    sessionId: "session-001",
    agentId: "coding-assistant",
  },
  {
    timestamp: new Date(Date.now() - 300000).toISOString(),
    level: "error",
    message: "Failed to read file: not found",
    sessionId: "session-002",
    agentId: "reviewer",
  },
];

const server = new EnvMCPServer({
  describeEnv: () => mockEnv,
  listProfiles: () => mockProfiles,
  queryLogs: (params) => {
    let logs = [...mockLogs];
    if (params?.sessionId) logs = logs.filter((l) => l.sessionId === params.sessionId);
    if (params?.agentId) logs = logs.filter((l) => l.agentId === params.agentId);
    if (params?.level) logs = logs.filter((l) => l.level === params.level);
    if (params?.since) logs = logs.filter((l) => l.timestamp >= params.since!);
    if (params?.until) logs = logs.filter((l) => l.timestamp <= params.until!);
    if (params?.limit) logs = logs.slice(0, params.limit);
    return logs;
  },
  listAgents: (params) => {
    let agents: AgentSpec[] = params?.profileId
      ? (mockProfiles.find((p) => p.id === params.profileId)?.primaryAgents ?? [])
      : mockProfiles.flatMap((p) => p.primaryAgents);
    if (params?.role) agents = agents.filter((a) => a.role === params.role);
    return agents;
  },
  getAgent: (id, profileId) => {
    const pool = profileId
      ? mockProfiles.find((p) => p.id === profileId)?.primaryAgents ?? []
      : mockProfiles.flatMap((p) => p.primaryAgents);
    const agent = pool.find((a) => a.id === id);
    if (!agent) throw new Error(`Agent not found: ${id}`);
    return agent;
  },
});

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("Env MCP Server started on stdio");
