import { z } from "zod";
import type { TraceConfig } from "./trace-config.js";

// Provider 配置 (providers.jsonc)
const ProviderConfig = z.object({
  id: z.string().optional().describe("Provider ID (key from providers object)"),
  name: z.string().describe("Provider display name"),
  description: z.string().optional().describe("Provider description"),
  baseURL: z.string().describe("Provider API base URL"),
  apiKey: z.string().optional().describe("API key (supports ${ENV_VAR} syntax)"),
  models: z.array(z.string()).optional().describe("Available models"),
  defaultModel: z.string().optional().describe("Default model for this provider"),
});

// Agent 配置（基于 env_spec/types.ts AgentSpec）
const AgentConfig = z.object({
  id: z.string(),
  role: z.enum(["primary", "sub"]),
  promptId: z.string().optional(),
  promptOverride: z.string().optional(),
  allowedTools: z.array(z.string()).optional(),
  deniedTools: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Environment Profile 配置
const ProfileConfig = z.object({
  id: z.string(),
  displayName: z.string(),
  primaryAgents: z.array(AgentConfig),
  subAgents: z.array(AgentConfig).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Environment 运行时配置
const EnvironmentRuntimeConfig = z.object({
  id: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  capabilities: z.object({
    logs: z.boolean().optional(),
    events: z.boolean().optional(),
    metrics: z.boolean().optional(),
    profiles: z.boolean().optional(),
    mcpTools: z.boolean().optional(),
  }).optional(),
  profiles: z.array(ProfileConfig).optional(),
});

// Auth Provider 配置（auth.json）
const AuthProviderConfig = z.object({
  type: z.enum(["api", "oauth", "basic"]).describe("Authentication type"),
  key: z.string().describe("API key or token"),
  baseURL: z.string().optional().describe("Provider base URL if different from default"),
  metadata: z.record(z.unknown()).optional().describe("Additional auth metadata"),
});

// Auth 配置 Schema（auth.json）
export const AuthConfig = z.record(AuthProviderConfig).describe(
  "Authentication configurations for providers, keyed by provider name"
);

// ========== Sandbox 配置 ==========

// 沙箱文件系统配置
const SandboxFilesystemConfig = z.object({
  denyRead: z.array(z.string()).optional().describe("Paths denied for reading (e.g., '~/.ssh', '~/.aws')"),
  allowWrite: z.array(z.string()).optional().describe("Paths allowed for writing (e.g., '.', '/tmp')"),
  denyWrite: z.array(z.string()).optional().describe("Paths denied for writing (e.g., '.env', '~/.aws')"),
}).describe("Filesystem restrictions for sandbox");

// 沙箱网络配置
const SandboxNetworkConfig = z.object({
  allowedDomains: z.array(z.string()).optional().describe("Allowed domain patterns (e.g., 'github.com', '*.npmjs.org')"),
  deniedDomains: z.array(z.string()).optional().describe("Denied domain patterns"),
}).describe("Network restrictions for sandbox");

// Docker 沙箱配置（未来支持）
const SandboxDockerConfig = z.object({
  image: z.string().optional().describe("Docker image to use"),
  networkMode: z.enum(["bridge", "host", "none"]).optional().describe("Docker network mode"),
  volumes: z.record(z.string(), z.string()).optional().describe("Volume mappings"),
}).describe("Docker-specific configuration (when sandbox type is 'docker')");

// 沙箱动作过滤配置
const SandboxActionFilterConfig = z.object({
  include: z.array(z.string()).optional().describe("Action names to include in sandbox (e.g., ['bash', 'mcp_*'])"),
  exclude: z.array(z.string()).optional().describe("Action names to exclude from sandbox"),
}).describe("Filter which actions to sandbox by action name patterns");

// 沙箱配置
export const SandboxConfig = z.object({
  enabled: z.boolean().optional().default(false).describe("Enable sandbox for this environment"),
  type: z.enum(["native", "docker"]).default("native").describe("Sandbox type: 'native' uses OS-level sandboxing, 'docker' uses Docker containers"),
  actionFilter: SandboxActionFilterConfig.optional().describe("Filter which actions to sandbox"),
  filesystem: SandboxFilesystemConfig.optional().describe("Filesystem restrictions"),
  network: SandboxNetworkConfig.optional().describe("Network restrictions"),
  docker: SandboxDockerConfig.optional().describe("Docker-specific configuration (when type is 'docker')"),
}).describe("Sandbox configuration for isolating tool execution");

// Session 持久化配置
const SessionPersistenceConfig = z.object({
  mode: z.enum(["memory", "file", "sqlite"]).default("sqlite").describe("Session storage mode: 'memory' for in-memory only, 'file' for persistent file storage, 'sqlite' for SQLite database (default)"),
  path: z.string().optional().describe("Custom storage path (defaults to XDG data directory)"),
  autoSave: z.boolean().default(true).describe("Auto-save session changes to disk"),
});

// 主配置 Schema
export const ConfigInfo = z.object({
  // === Environment 标识（用于 Environment 配置）===
  id: z.string().optional().describe("Environment identifier (e.g., 'os_env', 'web_env')"),
  displayName: z.string().optional().describe("Human-readable display name"),
  description: z.string().optional().describe("Environment description"),
  
  // === 当前激活的 Environment ===
  // 指定当前使用哪个 Agent 运行时环境（如 'os_env', 'web_env'）
  activeEnvironment: z.string().optional().describe("Active Agent runtime environment name (e.g., 'os_env', 'web_env')"),
  
  // === 用户标识（用于事件路由）===
  clientId: z.string().optional().describe("User identifier for event routing (e.g., email)"),
  
  // === 默认模型配置（当 Environment 未指定时回退到此配置）===
  defaultModel: z.string().optional().describe("Default LLM model, format: provider/model"),
  baseURL: z.string().optional().describe("Default LLM provider base URL"),
  apiKey: z.string().optional().describe("Default LLM API key"),
  
  // === Provider 配置 (providers.jsonc) ===
  providers: z.record(ProviderConfig).optional().describe("Provider configurations from providers.jsonc"),
  
  // === Environment 运行时配置（从 environments/{env}/config.jsonc 加载）===
  environment: EnvironmentRuntimeConfig.optional().describe("Agent runtime environment configuration"),
  
  // === Agents 配置（从 environments/{env}/agents.jsonc 加载）===
  agents: z.array(AgentConfig).optional().describe("Agent specifications for this environment"),
  
  // === Session 持久化配置 ===
  session: z.object({
    persistence: SessionPersistenceConfig.optional().describe("Session persistence configuration"),
  }).optional().describe("Session management configuration"),
  
  // === Trace 配置 ===
  trace: z.object({
    enabled: z.boolean().optional().describe("Enable trace/span collection"),
    storagePath: z.string().optional().describe("Custom storage path for traces"),
    recordResult: z.boolean().optional().describe("Record function results in traces"),
    recordParams: z.boolean().optional().describe("Record function parameters in traces"),
    log: z.boolean().optional().describe("Log trace events to server.log"),
    maxLogSize: z.number().optional().describe("Max log size for trace parameters/results"),
  }).optional().describe("Trace configuration for span collection"),
  
  // === 日志配置 ===
  logging: z.object({
    path: z.string().optional().describe("Custom log directory path (overrides default XDG path)"),
    level: z.enum(["debug", "info", "warn", "error"]).optional().describe("Log level"),
    enableFile: z.boolean().optional().describe("Enable file logging (default: true)"),
  }).optional().describe("Logging configuration"),
  
  // === MCP 配置（从 environments/{env}/config.jsonc 加载）===
  mcp: z.object({
    server: z.object({
      enabled: z.boolean().optional().describe("Enable MCP Server"),
      transport: z.enum(["stdio", "http"]).optional().describe("Transport type"),
      http: z.object({
        port: z.number().int().positive().optional().describe("HTTP port"),
        host: z.string().optional().describe("HTTP host"),
      }).optional(),
    }).optional().describe("MCP Server configuration"),
    clients: z.record(
      z.string(),
      z.union([
        z.object({
          type: z.literal("local"),
          command: z.array(z.string()).describe("Command to run the MCP server"),
          environment: z.record(z.string(), z.string()).optional().describe("Environment variables"),
          enabled: z.boolean().optional().describe("Enable this MCP server"),
          timeout: z.number().int().positive().optional().describe("Timeout in milliseconds"),
        }),
        z.object({
          type: z.literal("remote"),
          url: z.string().url().describe("Remote MCP server URL"),
          enabled: z.boolean().optional().describe("Enable this MCP server"),
          headers: z.record(z.string(), z.string()).optional().describe("HTTP headers"),
          oauth: z.union([
            z.object({
              clientId: z.string().optional().describe("OAuth client ID"),
              clientSecret: z.string().optional().describe("OAuth client secret"),
              scope: z.string().optional().describe("OAuth scope"),
            }),
            z.literal(false),
          ]).optional().describe("OAuth configuration"),
          timeout: z.number().int().positive().optional().describe("Timeout in milliseconds"),
        }),
        z.object({ enabled: z.boolean() }),
      ])
    ).optional().describe("MCP Clients configuration"),
  }).optional().describe("MCP configuration (Server and Clients)"),
  
  // === Sandbox 配置 ===
  sandbox: SandboxConfig.optional().describe("Sandbox configuration for isolating tool execution"),
  
  // === 其他配置（预留扩展）===
  metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
  
  // === 内部字段（不通过配置文件设置）===
  _environmentPath: z.string().optional().describe("Environment directory path (internal)"),
});

export namespace Config {
  export type Info = z.infer<typeof ConfigInfo>;
  export type Auth = z.infer<typeof AuthConfig>;
  export type SandboxConfig = z.infer<typeof SandboxConfig>;
}
