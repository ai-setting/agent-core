import { BaseEnvironment } from "../../core/environment/base/base-environment.js";
import type { EnvDescription, EnvProfile, AgentSpec } from "../types.js";

export interface BaseEnvMeta {
  /** 当前 Environment 的标识（例如 "os-env", "server-env"） */
  id?: string;
  /** 用于展示的名称 */
  displayName?: string;
  /** 版本号，可选 */
  version?: string;
}

/**
 * 从 BaseEnvironment 推导出一个默认的 EnvDescription。
 *
 * 约定：
 * - 使用 system prompt（id: "system"）作为默认 primary agent 的 promptId（如果存在）
 * - 默认只有一个 profile，id 为 "default"
 */
export function createBaseEnvDescription(
  env: BaseEnvironment,
  meta: BaseEnvMeta = {}
): EnvDescription {
  const id = meta.id ?? "base-env";
  const displayName = meta.displayName ?? "Base Environment";

  const profiles = createBaseEnvProfiles(env, meta);

  return {
    id,
    displayName,
    version: meta.version,
    capabilities: {
      logs: false, // 默认不声明日志能力，由具体 Env 子类声明
      events: true, // BaseEnvironment 支持流式事件 hook
      metrics: true,
      profiles: true,
      mcpTools: false,
    },
    profiles,
  };
}

/**
 * 从 BaseEnvironment 推导出一个默认的 EnvProfile 列表。
 *
 * 当前实现：
 * - 一个 profile: "default"
 * - 一个 primary agent: "default"，promptId 优先指向 "system"
 * - allowedTools 为当前 env 已注册的所有工具名称
 */
export function createBaseEnvProfiles(
  env: BaseEnvironment,
  meta: BaseEnvMeta = {}
): EnvProfile[] {
  const tools = (env as any).listTools?.() as { name: string }[] | undefined;
  const toolNames = tools ? tools.map((t) => t.name) : [];

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

