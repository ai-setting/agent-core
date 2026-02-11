import type { Environment } from "../core/environment/index.js";
// 为避免直接绑定到具体 MCP 实现，这里定义一个最小的 Server 接口，
// 方便后续用实际 MCP Server 适配，当前实现主要用于类型与单测。
export interface EnvMcpServerLike {
  tool(name: string, handler: (params: unknown) => Promise<unknown> | unknown): void;
}
import type { EnvDescription, EnvProfile, AgentSpec, LogEntry } from "./types.js";
import { createBaseEnvDescription, createBaseEnvProfiles, type BaseEnvMeta, type EnvOptionsSource } from "./base_env/index.js";

// MCP SDK：使用 McpServer（Server 已废弃），传输层由调用方 connect，不绑定 stdio/http
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/** 复用 MCP SDK 的 stdio 传输层，无需定制；HTTP 等可用 SDK 的 StreamableHTTP 等 */
export { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
/** 复用 MCP SDK 的 Streamable HTTP 服务端传输层（用于 HTTP 远程模式） */
export { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

function toContent(result: unknown): CallToolResult["content"] {
  return [{ type: "text" as const, text: JSON.stringify(result, null, 2) }];
}
function toErrorContent(err: unknown): CallToolResult["content"] {
  return [
    {
      type: "text" as const,
      text: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }, null, 2),
    },
  ];
}

/**
 * 服务器侧 Env 协议适配器（基于 MCP Server）。
 *
 * 设计理念（与 info_feed_mcp 一致）：
 * - 业务层：只定义「如何处理 request、如何返回响应」，与 stdio/http 无关
 * - 传输层：复用 MCP SDK 的 StdioServerTransport / StreamableHTTP 等，由调用方 new 并 connect
 * - 对接：new EnvMCPServer(options) 得到 Server，再 server.connect(transport)；启动方式由配置（如 .json）决定
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

/**
 * 基于 MCP SDK McpServer 的 Env MCP Server（与 info_feed_mcp 同构；SDK 的 Server 已废弃，改用 McpServer）。
 *
 * - 继承 SDK 的 McpServer，用 registerTool() 注册 env/* 能力，只负责「如何处理 request、如何返回响应」
 * - 传输层不在这里定死：调用方 new StdioServerTransport() 或其它 transport，再 server.connect(transport)
 * - 启动方式由调用方或配置文件（如 .json 的 command）决定
 *
 * 用法：
 *   const server = new EnvMCPServer(options);
 *   await server.connect(new StdioServerTransport());
 *
 * 或配合 BaseEnvironment：
 *   const server = new EnvMCPServer(createBaseEnvMcpServerOptions(env, meta));
 *   await server.connect(new StdioServerTransport());
 */
export class EnvMCPServer extends McpServer {
  constructor(options: EnvServerOptions) {
    super({ name: "env-mcp", version: "1.0.0" }, { capabilities: { tools: {} } });

    this.registerTool("env/get_description", {
      description: "获取当前环境的静态描述（id、displayName、version、capabilities 等）",
    }, async () => {
      try {
        const result = await Promise.resolve(options.describeEnv());
        return { content: toContent(result), isError: false };
      } catch (err) {
        return { content: toErrorContent(err), isError: true };
      }
    });

    if (options.listProfiles) {
      this.registerTool("env/list_profiles", {
        description: "列出当前 Environment 支持的 profiles",
      }, async () => {
        try {
          const profiles = await Promise.resolve(options.listProfiles!());
          return { content: toContent({ profiles }), isError: false };
        } catch (err) {
          return { content: toErrorContent(err), isError: true };
        }
      });

      this.registerTool("env/get_profile", {
        description: "按 id 获取单个 profile",
        inputSchema: { id: z.string() },
      }, async (args) => {
        try {
          const profiles = await Promise.resolve(options.listProfiles!());
          const profile = profiles.find((p) => p.id === args.id);
          if (!profile) throw new Error(`Profile not found: ${args.id}`);
          return { content: toContent(profile), isError: false };
        } catch (err) {
          return { content: toErrorContent(err), isError: true };
        }
      });
    }

    if (options.queryLogs) {
      this.registerTool("env/query_logs", {
        description: "查询结构化日志",
        inputSchema: {
          sessionId: z.string().optional(),
          agentId: z.string().optional(),
          level: z.enum(["debug", "info", "warn", "error"]).optional(),
          since: z.string().optional(),
          until: z.string().optional(),
          limit: z.number().optional(),
        },
      }, async (args) => {
        try {
          const logs = await Promise.resolve(
            options.queryLogs!({
              sessionId: args.sessionId,
              agentId: args.agentId,
              level: args.level,
              since: args.since,
              until: args.until,
              limit: args.limit,
            })
          );
          return { content: toContent({ logs }), isError: false };
        } catch (err) {
          return { content: toErrorContent(err), isError: true };
        }
      });
    }

    if (options.listAgents) {
      this.registerTool("env/list_agents", {
        description: "列出当前 Environment 中的 agents",
        inputSchema: {
          role: z.enum(["primary", "sub"]).optional(),
          profileId: z.string().optional(),
        },
      }, async (args) => {
        try {
          const agents = await Promise.resolve(
            options.listAgents!({ role: args.role, profileId: args.profileId })
          );
          return { content: toContent({ agents }), isError: false };
        } catch (err) {
          return { content: toErrorContent(err), isError: true };
        }
      });
    }

    if (options.getAgent) {
      this.registerTool("env/get_agent", {
        description: "获取指定 agent 的详情",
        inputSchema: { id: z.string(), profileId: z.string().optional() },
      }, async (args) => {
        try {
          const agent = await Promise.resolve(options.getAgent!(args.id, args.profileId));
          return { content: toContent(agent), isError: false };
        } catch (err) {
          return { content: toErrorContent(err), isError: true };
        }
      });
    }
  }
}

/** 内部：把 EnvServerOptions 挂到 EnvMcpServerLike 上 */
function applyEnvServerOptions<S extends EnvMcpServerLike>(server: S, options: EnvServerOptions): S {
  server.tool("env/get_description", async () => await options.describeEnv());

  if (options.listProfiles) {
    server.tool("env/list_profiles", async () => {
      const profiles = await options.listProfiles!();
      return { profiles };
    });
    server.tool("env/get_profile", async (params: any) => {
      const profiles = await options.listProfiles!();
      const profile = profiles.find((p) => p.id === params?.id);
      if (!profile) throw new Error(`Profile not found: ${params?.id}`);
      return profile;
    });
  }

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

  if (options.listAgents) {
    server.tool("env/list_agents", async (params: any) => {
      const agents = await options.listAgents!({ role: params?.role, profileId: params?.profileId });
      return { agents };
    });
  }

  if (options.getAgent) {
    server.tool("env/get_agent", async (params: any) => {
      return await options.getAgent!(params?.id, params?.profileId);
    });
  }

  return server;
}

/**
 * 从 env 实例推导 base options，再与 overrides 合并（未在 overrides 中提供的保持 base）。
 */
function isEnvServerOptions(x: unknown): x is EnvServerOptions {
  return typeof x === "object" && x !== null && typeof (x as EnvServerOptions).describeEnv === "function";
}

/**
 * 往已有 EnvMcpServerLike 上挂 env/* tools。
 *
 * 重载 1（从 env 推导 + 可选覆盖）：
 * - 传入 Environment，从 env 推导 base options（describeEnv、listProfiles、listAgents、getAgent、queryLogs 由 env.getProfiles/queryLogs 或默认推导），
 * - 可选 meta 覆盖 id/displayName/version，
 * - 可选 optionsOverrides 补充或覆盖。
 *
 * 重载 2（直接传 options）：
 * - 传入完整 EnvServerOptions，适用于已有现成 options 的场景。
 */
export function createEnvMcpServer<S extends EnvMcpServerLike>(
  server: S,
  env: EnvOptionsSource,
  meta?: BaseEnvMeta,
  optionsOverrides?: Partial<EnvServerOptions>
): S;
export function createEnvMcpServer<S extends EnvMcpServerLike>(
  server: S,
  _env: Environment,
  options: EnvServerOptions
): S;
export function createEnvMcpServer<S extends EnvMcpServerLike>(
  server: S,
  env: EnvOptionsSource | Environment,
  metaOrOptions?: BaseEnvMeta | EnvServerOptions,
  optionsOverrides?: Partial<EnvServerOptions>
): S {
  let options: EnvServerOptions;
  if (isEnvServerOptions(metaOrOptions)) {
    options = metaOrOptions;
  } else {
    const base = createBaseEnvMcpServerOptions(env as EnvOptionsSource, (metaOrOptions as BaseEnvMeta) ?? {});
    options = { ...base, ...optionsOverrides };
  }
  return applyEnvServerOptions(server, options);
}

/**
 * 基于 env 的默认 Env MCP Server（往已有 EnvMcpServerLike 上挂 env tools）。
 * 等价于 createEnvMcpServer(server, env, meta)。
 */
export function createBaseEnvMcpServer<S extends EnvMcpServerLike>(
  server: S,
  env: EnvOptionsSource,
  meta: BaseEnvMeta = {}
): S {
  return createEnvMcpServer(server, env, meta);
}

/**
 * 完全从 env 实例构造 EnvServerOptions（describeEnv、listProfiles、listAgents、getAgent 由 env.getProfiles 或 base_env 默认推导；
 * 若 env 实现 queryLogs 则一并挂上）。仅依赖 core 的 Environment 接口。
 *
 * 用法：
 *   const server = new EnvMCPServer(createBaseEnvMcpServerOptions(env, meta));
 *   server.connect(new StdioServerTransport());
 */
export function createBaseEnvMcpServerOptions(
  env: EnvOptionsSource,
  meta: BaseEnvMeta = {}
): EnvServerOptions {
  const getProfiles = async (): Promise<EnvProfile[]> => {
    if (typeof env.getProfiles === "function") {
      const out = await Promise.resolve(env.getProfiles());
      return (Array.isArray(out) ? out : []) as EnvProfile[];
    }
    return createBaseEnvProfiles(env, meta);
  };

  const options: EnvServerOptions = {
    describeEnv: async () => createBaseEnvDescription(env, meta, await getProfiles()),
    listProfiles: getProfiles,
    listAgents: async (params) => {
      const profiles = await getProfiles();
      let agents = profiles.flatMap((p) => p.primaryAgents);
      if (params?.profileId) {
        const p = profiles.find((x) => x.id === params.profileId);
        agents = p ? p.primaryAgents : [];
      }
      if (params?.role) agents = agents.filter((a) => a.role === params.role);
      return agents;
    },
    getAgent: async (id, profileId) => {
      const profiles = await getProfiles();
      const pool = profileId
        ? profiles.find((p) => p.id === profileId)?.primaryAgents ?? []
        : profiles.flatMap((p) => p.primaryAgents);
      const agent = pool.find((a) => a.id === id);
      if (!agent) throw new Error(`Agent not found: ${id}`);
      return agent;
    },
  };

  if (typeof env.queryLogs === "function") {
    options.queryLogs = (params) => env.queryLogs!(params);
  }

  return options;
}


