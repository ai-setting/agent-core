#!/usr/bin/env bun
/**
 * @fileoverview Env MCP Server 示例：完全从 env 实例构建 options
 *
 * 不传任何 EnvServerOptions，仅通过 createBaseEnvMcpServerOptions(env, meta) 从 env 推导：
 * - describeEnv / listProfiles：由 base_env 从 env.getPrompt、env.listTools 推导，或由 env.getProfiles() 提供
 * - listAgents / getAgent：由 createBaseEnvMcpServerOptions 从 profiles 推导
 * - queryLogs：若 env 实现 queryLogs 则自动挂上
 *
 * 用法:
 *   bun run examples/env-mcp-server-from-env.ts
 *
 * 测试:
 *   ENV_MCP_SERVER=examples/env-mcp-server-from-env.ts bun run examples/env-client-test.ts
 */

import { EnvMCPServer, StdioServerTransport, createBaseEnvMcpServerOptions } from "../packages/core/src/env_spec/server.js";
import type { EnvOptionsSource } from "../packages/core/src/env_spec/base_env/index.js";
import type { EnvProfile, LogEntry } from "../packages/core/src/env_spec/types.js";

/** 实现 EnvOptionsSource：getPrompt + getTools（默认推导用），getProfiles（提供 profiles），queryLogs（提供日志能力）。示例仅用于推导 options，getTools 返回最小可推导结构即可。 */
const env = {
  getPrompt: (id: string) => (id === "system" ? { id: "system", content: "" } : undefined),
  getTools: () => [{ name: "bash" }, { name: "file_read" }, { name: "file_write" }],

  getProfiles: (): EnvProfile[] => [
    {
      id: "default",
      displayName: "Default Profile",
      primaryAgents: [
        { id: "coding-assistant", role: "primary", promptId: "system", allowedTools: ["bash", "file_read", "file_write"] },
        { id: "reviewer", role: "sub", promptId: "system", allowedTools: ["file_read"] },
      ],
    },
  ],

  queryLogs: async (): Promise<LogEntry[]> => [],
} as unknown as EnvOptionsSource;

const meta = { id: "from-env", displayName: "Demo From Env", version: "1.0.0" };
const options = createBaseEnvMcpServerOptions(env, meta);

const server = new EnvMCPServer(options);
const transport = new StdioServerTransport();
await server.connect(transport);

console.error("Env MCP Server (from env) started on stdio");
