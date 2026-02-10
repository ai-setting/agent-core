#!/usr/bin/env bun
/**
 * @fileoverview Env MCP Client 测试示例
 * 
 * 演示如何：
 * 1. 以子进程方式启动 env-mcp-server
 * 2. 通过 stdio 或 HTTP 与 server 通信
 * 3. 使用 EnvClient 调用所有接口
 * 
 * 用法:
 *   bun run examples/env-client-test.ts          # 使用 stdio 模式（默认）
 *   bun run examples/env-client-test.ts --http   # 使用 HTTP 模式
 */

import { spawn, type Subprocess } from "bun";
import { EnvClient, type EnvRpcClient } from "../packages/core/src/env_spec/client.js";

// 配置
const USE_HTTP = process.argv.includes("--http");
const SERVER_PORT = 3457;

/**
 * Stdio RPC Client - 通过子进程 stdio 通信
 */
class StdioRpcClient implements EnvRpcClient {
  private process: Subprocess;
  private requestId = 0;
  private pendingRequests = new Map<string | number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private decoder = new TextDecoder();
  private buffer = "";

  constructor(serverScript: string) {
    // 启动 server 子进程
    const bunPath = process.execPath;
    this.process = spawn([bunPath, "run", serverScript], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });

    // 监听 server 输出
    this.process.stdout.pipeTo(
      new WritableStream({
        write: (chunk: Uint8Array) => {
          this.buffer += this.decoder.decode(chunk, { stream: true });
          
          const lines = this.buffer.split("\n");
          this.buffer = lines.pop() || "";
          
          for (const line of lines) {
            this.handleResponse(line.trim());
          }
        },
      })
    );

    // 转发 stderr 到 console
    this.process.stderr.pipeTo(
      new WritableStream({
        write: (chunk: Uint8Array) => {
          process.stderr.write(chunk);
        },
      })
    );
  }

  private handleResponse(line: string) {
    if (!line) return;
    
    try {
      const response = JSON.parse(line);
      const pending = this.pendingRequests.get(response.id);
      
      if (pending) {
        this.pendingRequests.delete(response.id);
        
        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    } catch (err) {
      console.error("[Client] Failed to parse response:", line);
    }
  }

  async call(method: string, params: unknown): Promise<unknown> {
    const id = ++this.requestId;
    const request = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      
      // 发送请求到 server
      this.process.stdin.write(JSON.stringify(request) + "\n");
      
      // 设置超时
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 5000);
    });
  }

  async close() {
    this.process.kill();
    await this.process.exited;
  }
}

/**
 * HTTP RPC Client - 通过 HTTP 通信
 */
class HttpRpcClient implements EnvRpcClient {
  private baseUrl: string;

  constructor(port: number) {
    this.baseUrl = `http://localhost:${port}`;
  }

  async call(method: string, params: unknown): Promise<unknown> {
    const request = {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    };

    const response = await fetch(`${this.baseUrl}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error.message);
    }
    
    return result.result;
  }
}

/**
 * 运行所有测试
 */
async function runTests(client: EnvClient) {
  console.log("\n========================================");
  console.log("  Env Client Integration Tests");
  console.log("========================================\n");

  // Test 1: Get Description
  console.log("Test 1: Get Environment Description");
  console.log("----------------------------------------");
  try {
    const desc = await client.getDescription();
    console.log("✅ Success");
    console.log(`   ID: ${desc.id}`);
    console.log(`   Name: ${desc.displayName}`);
    console.log(`   Version: ${desc.version}`);
    console.log(`   Capabilities:`, desc.capabilities);
  } catch (err: any) {
    console.log("❌ Failed:", err.message);
  }

  // Test 2: List Profiles
  console.log("\nTest 2: List Profiles");
  console.log("----------------------------------------");
  try {
    const profiles = await client.listProfiles();
    console.log("✅ Success");
    profiles.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.id} - ${p.displayName}`);
      console.log(`      Agents: ${p.primaryAgents.length}`);
    });
  } catch (err: any) {
    console.log("❌ Failed:", err.message);
  }

  // Test 3: Get Profile
  console.log("\nTest 3: Get Specific Profile");
  console.log("----------------------------------------");
  try {
    const profile = await client.getProfile("default");
    console.log("✅ Success");
    console.log(`   Profile: ${profile.displayName}`);
    console.log(`   Agents:`, profile.primaryAgents.map((a) => a.id).join(", "));
  } catch (err: any) {
    console.log("❌ Failed:", err.message);
  }

  // Test 4: List All Agents
  console.log("\nTest 4: List All Agents");
  console.log("----------------------------------------");
  try {
    const agents = await client.listAgents();
    console.log("✅ Success");
    agents.forEach((a, i) => {
      console.log(`   ${i + 1}. ${a.id} (${a.role})`);
      console.log(`      Tools: ${a.allowedTools?.join(", ") || "none"}`);
    });
  } catch (err: any) {
    console.log("❌ Failed:", err.message);
  }

  // Test 5: List Primary Agents
  console.log("\nTest 5: List Primary Agents Only");
  console.log("----------------------------------------");
  try {
    const agents = await client.listAgents({ role: "primary" });
    console.log("✅ Success");
    console.log(`   Found ${agents.length} primary agents`);
    agents.forEach((a) => console.log(`   - ${a.id}`));
  } catch (err: any) {
    console.log("❌ Failed:", err.message);
  }

  // Test 6: Get Agent
  console.log("\nTest 6: Get Specific Agent");
  console.log("----------------------------------------");
  try {
    const agent = await client.getAgent("coding-assistant");
    console.log("✅ Success");
    console.log(`   Agent: ${agent.id}`);
    console.log(`   Role: ${agent.role}`);
    console.log(`   Prompt: ${agent.promptId}`);
    console.log(`   Allowed Tools: ${agent.allowedTools?.join(", ")}`);
  } catch (err: any) {
    console.log("❌ Failed:", err.message);
  }

  // Test 7: Query All Logs
  console.log("\nTest 7: Query All Logs");
  console.log("----------------------------------------");
  try {
    const logs = await client.queryLogs({});
    console.log("✅ Success");
    console.log(`   Total logs: ${logs.length}`);
    logs.forEach((log) => {
      console.log(`   [${log.level.toUpperCase()}] ${log.message.substring(0, 50)}${log.message.length > 50 ? "..." : ""}`);
    });
  } catch (err: any) {
    console.log("❌ Failed:", err.message);
  }

  // Test 8: Query Logs by Session
  console.log("\nTest 8: Query Logs by Session ID");
  console.log("----------------------------------------");
  try {
    const logs = await client.queryLogs({ sessionId: "session-001" });
    console.log("✅ Success");
    console.log(`   Logs for session-001: ${logs.length}`);
    logs.forEach((log) => {
      console.log(`   [${log.timestamp}] ${log.message}`);
    });
  } catch (err: any) {
    console.log("❌ Failed:", err.message);
  }

  // Test 9: Query Logs by Level
  console.log("\nTest 9: Query Logs by Level (error only)");
  console.log("----------------------------------------");
  try {
    const logs = await client.queryLogs({ level: "error" });
    console.log("✅ Success");
    console.log(`   Error logs: ${logs.length}`);
    logs.forEach((log) => console.log(`   ❌ ${log.message}`));
  } catch (err: any) {
    console.log("❌ Failed:", err.message);
  }

  // Test 10: Query Logs with Limit
  console.log("\nTest 10: Query Logs with Limit");
  console.log("----------------------------------------");
  try {
    const logs = await client.queryLogs({ limit: 2 });
    console.log("✅ Success");
    console.log(`   Returned ${logs.length} logs (limited to 2)`);
  } catch (err: any) {
    console.log("❌ Failed:", err.message);
  }

  console.log("\n========================================");
  console.log("  All Tests Completed!");
  console.log("========================================\n");
}

/**
 * 主函数
 */
async function main() {
  let rpcClient: StdioRpcClient | HttpRpcClient;
  let serverProcess: ReturnType<typeof spawn> | null = null;

  if (USE_HTTP) {
    console.log("🌐 Using HTTP mode");
    console.log(`   Starting server on port ${SERVER_PORT}...`);
    
    // 启动 HTTP server 子进程
    const bunPath = process.execPath;
    serverProcess = spawn([bunPath, "run", "examples/env-mcp-server.ts", "--http"], {
      env: { ...process.env, PORT: String(SERVER_PORT) },
      stdout: "inherit",
      stderr: "inherit",
    });
    
    // 等待 server 启动
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    rpcClient = new HttpRpcClient(SERVER_PORT);
  } else {
    console.log("🔌 Using Stdio mode");
    console.log("   Starting server as subprocess...");
    
    rpcClient = new StdioRpcClient("examples/env-mcp-server.ts");
    
    // 等待 server 就绪
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const client = new EnvClient(rpcClient);

  try {
    await runTests(client);
  } finally {
    console.log("🧹 Cleaning up...");
    
    if (rpcClient instanceof StdioRpcClient) {
      await rpcClient.close();
    } else if (serverProcess) {
      serverProcess.kill();
      await serverProcess.exited;
    }
    
    console.log("✅ Done!");
  }
}

main().catch(console.error);
