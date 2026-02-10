export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AgentSpec {
  id: string;
  role: "primary" | "sub";
  promptId?: string;
  promptOverride?: string;
  allowedTools?: string[];
  deniedTools?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnvProfile {
  id: string;
  displayName: string;
  primaryAgents: AgentSpec[];
  subAgents?: AgentSpec[];
  metadata?: Record<string, unknown>;
}

export interface EnvDescription {
  id: string;
  displayName: string;
  version?: string;
  capabilities?: {
    logs?: boolean;
    events?: boolean;
    metrics?: boolean;
    profiles?: boolean;
    mcpTools?: boolean;
    [key: string]: unknown;
  };
  profiles?: EnvProfile[];
  metadata?: Record<string, unknown>;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  sessionId?: string;
  agentId?: string;
  toolName?: string;
  context?: Record<string, unknown>;
}

