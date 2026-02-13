import { z } from "zod";

// Provider 配置
const ProviderConfig = z.object({
  baseURL: z.string().optional().describe("Provider base URL"),
  apiKey: z.string().optional().describe("API key"),
  defaultModel: z.string().optional().describe("Default model for this provider"),
  models: z.array(z.string()).optional().describe("Available models for this provider"),
  description: z.string().optional().describe("Provider description"),
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

// Model 配置
const ModelConfig = z.object({
  provider: z.string(),
  modelId: z.string(),
  displayName: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
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

// 主配置 Schema
export const ConfigInfo = z.object({
  // === Environment 标识（用于 Environment 配置）===
  id: z.string().optional().describe("Environment identifier (e.g., 'os_env', 'web_env')"),
  displayName: z.string().optional().describe("Human-readable display name"),
  description: z.string().optional().describe("Environment description"),
  
  // === 当前激活的 Environment ===
  // 指定当前使用哪个 Agent 运行时环境（如 'os_env', 'web_env'）
  activeEnvironment: z.string().optional().describe("Active Agent runtime environment name (e.g., 'os_env', 'web_env')"),
  
  // === 默认模型配置（当 Environment 未指定时回退到此配置）===
  defaultModel: z.string().optional().describe("Default LLM model, format: provider/model"),
  baseURL: z.string().optional().describe("Default LLM provider base URL"),
  apiKey: z.string().optional().describe("Default LLM API key"),
  
  // === Provider 配置 ===
  provider: z.record(ProviderConfig).optional().describe("Provider-specific configurations"),
  
  // === Environment 运行时配置（从 environments/{env}/config.jsonc 加载）===
  environment: EnvironmentRuntimeConfig.optional().describe("Agent runtime environment configuration"),
  
  // === Agents 配置（从 environments/{env}/agents.jsonc 加载）===
  agents: z.array(AgentConfig).optional().describe("Agent specifications for this environment"),
  
  // === Models 配置（从 environments/{env}/models.jsonc 加载）===
  models: z.record(ModelConfig).optional().describe("Model configurations for this environment"),
  
  // === 其他配置（预留扩展）===
  metadata: z.record(z.unknown()).optional().describe("Additional metadata"),
});

export namespace Config {
  export type Info = z.infer<typeof ConfigInfo>;
  export type Auth = z.infer<typeof AuthConfig>;
}
