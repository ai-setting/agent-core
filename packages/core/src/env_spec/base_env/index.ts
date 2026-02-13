import type { Environment } from "../../core/environment/index.js";
import type { EnvDescription, EnvProfile, AgentSpec } from "../types.js";

/**
 * 仅用于从 env 推导 EnvServerOptions 的最小接口；类型均来自 core Environment，env_spec 不向 core 注入定义。
 */
export type EnvOptionsSource = Pick<Environment, "getPrompt" | "getTools"> &
  Partial<Pick<Environment, "getProfiles" | "queryLogs">>;

export interface BaseEnvMeta {
  /** 当前 Environment 的标识（例如 "os-env", "server-env"） */
  id?: string;
  /** 用于展示的名称 */
  displayName?: string;
  /** 版本号，可选 */
  version?: string;
}

/**
 * 从 Environment 推导出默认的 EnvDescription。
 *
 * @param profiles 若传入则直接使用（用于 createBaseEnvMcpServerOptions 中先异步 getProfiles 再拼 description）；否则用 createBaseEnvProfiles(env, meta)
 * - 若 env 实现 queryLogs，则 capabilities.logs = true
 */
export function createBaseEnvDescription(
  env: EnvOptionsSource,
  meta: BaseEnvMeta = {},
  profiles?: EnvProfile[]
): EnvDescription {
  const id = meta.id ?? "base-env";
  const displayName = meta.displayName ?? "Base Environment";
  const resolvedProfiles = profiles ?? createBaseEnvProfiles(env, meta);

  return {
    id,
    displayName,
    version: meta.version,
    capabilities: {
      logs: typeof env.queryLogs === "function",
      events: true,
      metrics: true,
      profiles: true,
      mcpTools: false,
    },
    profiles: resolvedProfiles,
  };
}

/**
 * 从 Environment 推导出 EnvProfile 列表。
 *
 * - 若 env 实现 getProfiles()，直接使用其返回值（与 EnvProfile 结构兼容，作类型断言）。
 * - 否则：一个 profile "default"，一个 primary agent "default"，promptId 指向 "system"（若存在），allowedTools 为 env.getTools() 工具名。
 */
export function createBaseEnvProfiles(
  env: EnvOptionsSource,
  meta: BaseEnvMeta = {}
): EnvProfile[] {
  if (typeof env.getProfiles === "function") {
    const out = env.getProfiles();
    if (Array.isArray(out)) return out as EnvProfile[];
    // 异步 getProfiles 由 createBaseEnvMcpServerOptions 的 listProfiles 处理，此处仅同步路径
  }

  const toolNames = env.getTools().map((t) => t.name);
  const hasSystemPrompt = !!env.getPrompt("system");

  const primaryAgent: AgentSpec = {
    id: "default",
    role: "primary",
    promptId: hasSystemPrompt ? "system" : undefined,
    allowedTools: toolNames,
  };

  const profile: EnvProfile = {
    id: "default",
    displayName: meta.displayName ?? "Default Profile",
    primaryAgents: [primaryAgent],
  };

  return [profile];
}

