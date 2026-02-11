#!/usr/bin/env bun
/**
 * @fileoverview Env MCP Server HTTP 示例（Streamable HTTP 传输层）
 *
 * 与 env-mcp-server.ts 同构：同一份 EnvServerOptions，仅传输层改为
 * WebStandardStreamableHTTPServerTransport，用 Bun.serve 暴露 HTTP。
 *
 * 用法:
 *   bun run examples/env-mcp-server-http.ts
 *   # 默认 http://localhost:3000，可通过 PORT=3001 覆盖
 *
 * 测试（先启动本 server，再另开终端）:
 *   ENV_MCP_HTTP_URL=http://localhost:3000 bun run examples/env-client-test.ts
 */

import {
  EnvMCPServer,
  WebStandardStreamableHTTPServerTransport,
} from "../packages/core/src/env_spec/server.js";
import type { EnvDescription, EnvProfile, AgentSpec, LogEntry } from "../packages/core/src/env_spec/types.js";

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

// 使用 stateful 模式（sessionIdGenerator），同一 transport 可处理多请求/多 session
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: () => crypto.randomUUID(),
});
await server.connect(transport);

const port = Number(process.env.PORT ?? 3000);
Bun.serve({
  port,
  fetch: (req) => transport.handleRequest(req),
});

console.error(`Env MCP Server (HTTP) started at http://localhost:${port}`);
