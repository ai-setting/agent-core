#!/usr/bin/env bun
/// <reference types="bun" />
/**
 * @fileoverview Env MCP Server 示例
 * 
 * 以进程方式启动一个基于 stdio 的 Env MCP Server
 * 通过 JSON-RPC over stdio 协议暴露环境描述、profiles、agents 和日志查询能力
 * 
 * 用法:
 *   bun run examples/env-mcp-server.ts
 * 
 * 协议:
 * - 输入: 每行一个 JSON-RPC 请求 (method: env/*)
 * - 输出: 每行一个 JSON-RPC 响应
 */

import type { EnvDescription, EnvProfile, AgentSpec, LogEntry } from "../packages/core/src/env_spec/types.js";

// 模拟的环境数据
const mockEnv: EnvDescription = {
  id: "demo-env",
  displayName: "Demo Environment",
  version: "1.0.0",
  capabilities: {
    logs: true,
    events: true,
    profiles: true,
  },
};

const mockProfiles: EnvProfile[] = [
  {
    id: "default",
    displayName: "Default Profile",
    primaryAgents: [
      {
        id: "coding-assistant",
        role: "primary",
        promptId: "system:coding",
        allowedTools: ["bash", "file_read", "file_write"],
      },
      {
        id: "reviewer",
        role: "sub",
        promptId: "system:review",
        allowedTools: ["file_read"],
      },
    ],
  },
  {
    id: "advanced",
    displayName: "Advanced Profile",
    primaryAgents: [
      {
        id: "architect",
        role: "primary",
        promptId: "system:architect",
        allowedTools: ["bash", "file_read", "file_write", "task"],
      },
    ],
  },
];

const mockLogs: LogEntry[] = [
  {
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    level: "info",
    message: "Environment initialized",
    sessionId: "session-001",
  },
  {
    timestamp: new Date(Date.now() - 1800000).toISOString(),
    level: "info",
    message: "Agent started: coding-assistant",
    sessionId: "session-001",
    agentId: "coding-assistant",
  },
  {
    timestamp: new Date(Date.now() - 900000).toISOString(),
    level: "warn",
    message: "Tool execution timeout: bash",
    sessionId: "session-001",
    agentId: "coding-assistant",
  },
  {
    timestamp: new Date(Date.now() - 300000).toISOString(),
    level: "error",
    message: "Failed to read file: not found",
    sessionId: "session-002",
    agentId: "reviewer",
  },
];

// 工具实现
const tools: Record<string, (params: any) => any> = {
  "env/get_description": () => mockEnv,
  
  "env/list_profiles": () => ({ profiles: mockProfiles }),
  
  "env/get_profile": (params: { id: string }) => {
    const profile = mockProfiles.find((p) => p.id === params.id);
    if (!profile) {
      throw new Error(`Profile not found: ${params.id}`);
    }
    return profile;
  },
  
  "env/list_agents": (params?: { role?: "primary" | "sub"; profileId?: string }) => {
    let agents: AgentSpec[] = [];
    
    if (params?.profileId) {
      const profile = mockProfiles.find((p) => p.id === params.profileId);
      if (profile) {
        agents = profile.primaryAgents;
      }
    } else {
      // 合并所有 profile 的 agents
      agents = mockProfiles.flatMap((p) => p.primaryAgents);
    }
    
    if (params?.role) {
      agents = agents.filter((a) => a.role === params.role);
    }
    
    return { agents };
  },
  
  "env/get_agent": (params: { id: string; profileId?: string }) => {
    const allAgents = mockProfiles.flatMap((p) => p.primaryAgents);
    const agent = allAgents.find((a) => a.id === params.id);
    if (!agent) {
      throw new Error(`Agent not found: ${params.id}`);
    }
    return agent;
  },
  
  "env/query_logs": (params: {
    sessionId?: string;
    agentId?: string;
    level?: LogEntry["level"];
    since?: string;
    until?: string;
    limit?: number;
  }) => {
    let logs = [...mockLogs];
    
    if (params?.sessionId) {
      logs = logs.filter((l) => l.sessionId === params.sessionId);
    }
    
    if (params?.agentId) {
      logs = logs.filter((l) => l.agentId === params.agentId);
    }
    
    if (params?.level) {
      logs = logs.filter((l) => l.level === params.level);
    }
    
    if (params?.since) {
      logs = logs.filter((l) => l.timestamp >= params.since!);
    }
    
    if (params?.until) {
      logs = logs.filter((l) => l.timestamp <= params.until!);
    }
    
    if (params?.limit) {
      logs = logs.slice(0, params.limit);
    }
    
    return { logs };
  },
};

// JSON-RPC 处理器
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

function handleRequest(req: JsonRpcRequest): JsonRpcResponse {
  try {
    const handler = tools[req.method];
    if (!handler) {
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: -32601,
          message: `Method not found: ${req.method}`,
        },
      };
    }
    
    const result = handler(req.params);
    return {
      jsonrpc: "2.0",
      id: req.id,
      result,
    };
  } catch (err: any) {
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: {
        code: -32000,
        message: err.message,
      },
    };
  }
}

// 启动模式检测
const mode = process.argv.includes("--http") ? "http" : "stdio";

if (mode === "stdio") {
  // Stdio 模式 - 用于进程间通信
  console.error("[Env MCP Server] Starting in stdio mode...");
  console.error("[Env MCP Server] PID:", process.pid);
  console.error("[Env MCP Server] Available methods:", Object.keys(tools).join(", "));
  
  // 从 stdin 读取 JSON-RPC 请求
  const decoder = new TextDecoder();
  let buffer = "";
  
  process.stdin.on("data", (chunk: Buffer) => {
    buffer += decoder.decode(chunk, { stream: true });
    
    // 按行分割处理
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // 保留最后一行（可能不完整）
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      try {
        const request: JsonRpcRequest = JSON.parse(trimmed);
        const response = handleRequest(request);
        // 输出到 stdout
        console.log(JSON.stringify(response));
      } catch (err) {
        console.error("[Env MCP Server] Parse error:", err);
      }
    }
  });
  
  process.stdin.on("end", () => {
    console.error("[Env MCP Server] Stdin closed, exiting...");
    process.exit(0);
  });
  
  process.on("SIGINT", () => {
    console.error("[Env MCP Server] Received SIGINT, exiting...");
    process.exit(0);
  });
  
} else {
  // HTTP 模式 - 用于测试
  const port = parseInt(process.env.PORT || "3001");
  
  Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      
      if (req.method === "POST" && url.pathname === "/rpc") {
        return req.text().then((body) => {
          try {
            const request: JsonRpcRequest = JSON.parse(body);
            const response = handleRequest(request);
            return new Response(JSON.stringify(response), {
              headers: { "Content-Type": "application/json" },
            });
          } catch (err) {
            return new Response(JSON.stringify({ error: "Invalid JSON" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
        });
      } else if (req.method === "GET" && url.pathname === "/health") {
        return new Response(JSON.stringify({ status: "ok", env: mockEnv.id }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      
      return new Response("Not Found", { status: 404 });
    },
  });
  
  console.log(`[Env MCP Server] HTTP mode running on port ${port}`);
  console.log(`[Env MCP Server] Health: http://localhost:${port}/health`);
  console.log(`[Env MCP Server] RPC: POST http://localhost:${port}/rpc`);
}
