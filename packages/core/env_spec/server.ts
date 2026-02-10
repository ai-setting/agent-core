import type { Environment } from "../src/core/environment/index.js";
// 为避免直接绑定到具体 MCP 实现，这里定义一个最小的 Server 接口，
// 方便后续用实际 MCP Server 适配，当前实现主要用于类型与单测。
export interface EnvMcpServerLike {
  tool(name: string, handler: (params: unknown) => Promise<unknown> | unknown): void;
}
import type { EnvDescription, EnvProfile, AgentSpec, LogEntry } from "./types.js";
import type { BaseEnvironment } from "../src/core/environment/base/base-environment.js";
import { createBaseEnvDescription, createBaseEnvProfiles, type BaseEnvMeta } from "./base_env/index.js";

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

  /**
   * 列出当前 Environment 中的 agents。
   */
  listAgents?: (params?: { role?: "primary" | "sub"; profileId?: string }) => Promise<AgentSpec[]> | AgentSpec[];

  /**
   * 获取指定 agent 的详情。
   */
  getAgent?: (id: string, profileId?: string) => Promise<AgentSpec> | AgentSpec;
}

export function createEnvMcpServer<S extends EnvMcpServerLike>(
  server: S,
  _env: Environment,
  options: EnvServerOptions
): S {

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

  // env/get_profile
  if (options.listProfiles) {
    server.tool("env/get_profile", async (params: any) => {
      const profiles = await options.listProfiles!();
      const profile = profiles.find((p) => p.id === params?.id);
      if (!profile) {
        throw new Error(`Profile not found: ${params?.id}`);
      }
      return profile;
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

  // env/list_agents
  if (options.listAgents) {
    server.tool("env/list_agents", async (params: any) => {
      const agents = await options.listAgents!({
        role: params?.role,
        profileId: params?.profileId,
      });
      return { agents };
    });
  }

  // env/get_agent
  if (options.getAgent) {
    server.tool("env/get_agent", async (params: any) => {
      const agent = await options.getAgent!(params?.id, params?.profileId);
      return agent;
    });
  }

  // TODO: 后续可以在这里把 env 的普通 tools 继续挂载到 MCP Server 上

  return server;
}

/**
 * 基于 BaseEnvironment 的默认 Env MCP Server。
 *
 * 用法：
 * - 直接传入一个 BaseEnvironment 子类实例（如 OsEnv / ServerEnvironment）
 * - 可选 meta 用于覆盖 id/displayName/version
 */
export function createBaseEnvMcpServer<S extends EnvMcpServerLike>(
  server: S,
  env: BaseEnvironment,
  meta: BaseEnvMeta = {}
): S {
  return createEnvMcpServer(server, env, {
    describeEnv: () => createBaseEnvDescription(env, meta),
    listProfiles: () => createBaseEnvProfiles(env, meta),
    // 默认不实现 queryLogs，由具体 Env 子类决定是否接入日志系统
  });
}


