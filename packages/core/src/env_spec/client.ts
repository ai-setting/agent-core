import type { EnvDescription, EnvProfile, AgentSpec, LogEntry } from "./types.js";

// MCP SDK：与 server 侧一致，基于官方 Client + 传输层，EnvClient 只做 env/* 的特化封装
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
export type { Transport };

/** 复用 MCP SDK 的 stdio 客户端传输层（spawn 子进程，stdio 通信） */
export { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
/** 复用 MCP SDK 的 Streamable HTTP 客户端传输层（用于 HTTP 远程模式） */
export { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
export { Client } from "@modelcontextprotocol/sdk/client/index.js";

/** 可传入 EnvClient 的 MCP 调用能力（SDK Client 或测试用 mock） */
export interface EnvMcpClientLike {
  callTool(params: { name: string; arguments?: unknown }): Promise<{
    content?: Array<{ type: string; text?: string }>;
    isError?: boolean;
  }>;
}

/**
 * 从 MCP callTool 结果中解析 JSON 文本；isError 时抛错。
 */
function parseToolResult<T>(raw: { content?: Array<{ type: string; text?: string }>; isError?: boolean }): T {
  if (raw.isError) {
    const text = raw.content?.find((c) => c.type === "text")?.text;
    const err = text ? (() => { try { return JSON.parse(text); } catch { return { error: text }; } })() : { error: "Unknown error" };
    throw new Error(typeof err.error === "string" ? err.error : JSON.stringify(err));
  }
  const text = raw.content?.find((c) => c.type === "text")?.text;
  if (text == null) throw new Error("Env tool returned no text content");
  return JSON.parse(text) as T;
}

/**
 * MCP Env 协议客户端封装（基于 MCP SDK Client）。
 *
 * 设计理念（与 server 侧一致）：
 * - 本质是一个 MCP Client，连接与传输由 SDK 的 Client + Transport 负责
 * - EnvClient 只做「env/* tools」的类型安全封装：getDescription、listProfiles、queryLogs 等
 * - 调用方：new Client() → connect(transport) → new EnvClient(client)，或直接用 createEnvClient(transport)
 * - 测试时可传入实现 EnvMcpClientLike 的 mock（如包装 EnvMcpServerLike 的 in-memory 适配器）
 */
export class EnvClient {
  constructor(private client: Client | EnvMcpClientLike) {}

  private async callEnvTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const raw = await this.client.callTool({ name, arguments: args });
    return parseToolResult<T>(raw as { content?: Array<{ type: string; text?: string }>; isError?: boolean });
  }

  async getDescription(): Promise<EnvDescription> {
    return this.callEnvTool<EnvDescription>("env/get_description");
  }

  async listProfiles(): Promise<EnvProfile[]> {
    const result = await this.callEnvTool<{ profiles: EnvProfile[] }>("env/list_profiles");
    return result.profiles;
  }

  async getProfile(id: string): Promise<EnvProfile> {
    return this.callEnvTool<EnvProfile>("env/get_profile", { id });
  }

  async listAgents(params?: { role?: "primary" | "sub"; profileId?: string }): Promise<AgentSpec[]> {
    const result = await this.callEnvTool<{ agents: AgentSpec[] }>("env/list_agents", params ?? {});
    return result.agents;
  }

  async getAgent(id: string, profileId?: string): Promise<AgentSpec> {
    return this.callEnvTool<AgentSpec>("env/get_agent", { id, profileId: profileId ?? undefined });
  }

  async queryLogs(params: {
    sessionId?: string;
    agentId?: string;
    level?: LogEntry["level"];
    since?: string;
    until?: string;
    limit?: number;
  }): Promise<LogEntry[]> {
    const result = await this.callEnvTool<{ logs: LogEntry[] }>("env/query_logs", params ?? {});
    return result.logs;
  }

  /** 底层 MCP Client（若为 SDK Client），用于需要直接 callTool / listTools 等时 */
  getMcpClient(): Client | EnvMcpClientLike {
    return this.client;
  }
}

const DEFAULT_CLIENT_INFO = { name: "env-mcp-client", version: "1.0.0" } as const;

/**
 * 创建并连接 MCP Client，再包装为 EnvClient（与 info_feed_mcp 用法同构）。
 *
 * 用法：
 *   const transport = new StdioClientTransport({ command: "bun", args: ["run", "examples/env-mcp-server.ts"] });
 *   const envClient = await createEnvClient(transport);
 *   const desc = await envClient.getDescription();
 */
export async function createEnvClient(transport: Transport): Promise<EnvClient> {
  const client = new Client(DEFAULT_CLIENT_INFO, {});
  await client.connect(transport);
  return new EnvClient(client);
}
