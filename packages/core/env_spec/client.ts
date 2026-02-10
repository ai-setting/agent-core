import type { EnvDescription, EnvProfile, AgentSpec, LogEntry } from "./types.js";

/**
 * MCP Env 协议客户端封装。
 *
 * 目标：
 * - 基于 @modelcontextprotocol/client，提供针对 Env 协议的类型安全封装
 * - 不重复实现传输层，只聚焦在方法名与参数/返回类型
 */
export interface EnvRpcClient {
  call(method: string, params: unknown): Promise<unknown>;
}

export class EnvClient {
  constructor(private client: EnvRpcClient) {}

  async getDescription(): Promise<EnvDescription> {
    const result = await this.client.call("env/get_description", {});
    return result as EnvDescription;
  }

  async listProfiles(): Promise<EnvProfile[]> {
    const result = await this.client.call("env/list_profiles", {});
    return (result as { profiles: EnvProfile[] }).profiles;
  }

  async getProfile(id: string): Promise<EnvProfile> {
    const result = await this.client.call("env/get_profile", { id });
    return result as EnvProfile;
  }

  async listAgents(params?: { role?: "primary" | "sub"; profileId?: string }): Promise<AgentSpec[]> {
    const result = await this.client.call("env/list_agents", params ?? {});
    return (result as { agents: AgentSpec[] }).agents;
  }

  async getAgent(id: string, profileId?: string): Promise<AgentSpec> {
    const result = await this.client.call("env/get_agent", { id, profileId });
    return result as AgentSpec;
  }

  async queryLogs(params: {
    sessionId?: string;
    agentId?: string;
    level?: LogEntry["level"];
    since?: string;
    until?: string;
    limit?: number;
  }): Promise<LogEntry[]> {
    const result = await this.client.call("env/query_logs", params);
    return (result as { logs: LogEntry[] }).logs;
  }
}

