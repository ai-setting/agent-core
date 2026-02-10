import type { Tool } from "../src/core/types/tool.js";
import type { Environment } from "../src/core/environment/index.js";
import type { Context } from "../src/core/types/context.js";
import { Server } from "@modelcontextprotocol/server";
import type { EnvDescription, EnvProfile, AgentSpec, LogEntry } from "./types.js";

/**
 * 服务器侧 Env 协议适配器（基于 MCP Server）。
 *
 * 目标：
 * - 复用 @modelcontextprotocol/server 的能力，不重复造轮子
 * - 把现有 Environment 实例通过一组标准 MCP tools 暴露出去
 *
 * 注意：
 * - 这里只提供最小骨架，细节实现会在后续迭代中补充
 */
export interface EnvServerOptions {
  /**
   * 当前环境的静态描述（除了动态部分如日志）。
   * 可以由调用方从代码或配置中构造。
   */
  describeEnv: () => Promise<EnvDescription> | EnvDescription;

  /**
   * 列出当前 Environment 支持的 profiles。
   */
  listProfiles?: () => Promise<EnvProfile[]> | EnvProfile[];

  /**
   * 查询结构化日志。
   */
  queryLogs?: (params: {
    sessionId?: string;
    agentId?: string;
    level?: LogEntry["level"];
    since?: string;
    until?: string;
    limit?: number;
  }) => Promise<LogEntry[]> | LogEntry[];
}

export function createEnvMcpServer(
  env: Environment,
  options: EnvServerOptions
): Server {
  const server = new Server({
    name: "agent-core-env",
    version: "0.1.0",
  });

  // env/get_description
  server.tool("env/get_description", async () => {
    return await options.describeEnv();
  });

  // env/list_profiles
  if (options.listProfiles) {
    server.tool("env/list_profiles", async () => {
      const profiles = await options.listProfiles!();
      return { profiles };
    });
  }

  // env/query_logs
  if (options.queryLogs) {
    server.tool("env/query_logs", async (params: any) => {
      const logs = await options.queryLogs!({
        sessionId: params?.sessionId,
        agentId: params?.agentId,
        level: params?.level,
        since: params?.since,
        until: params?.until,
        limit: params?.limit,
      });
      return { logs };
    });
  }

  // TODO: 后续可以在这里把 env 的普通 tools 继续挂载到 MCP Server 上

  return server;
}

