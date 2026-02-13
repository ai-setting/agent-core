#!/usr/bin/env bun
/**
 * @fileoverview Env MCP Client 测试示例（与 info_feed_mcp 同构）
 *
 * 支持两种传输层：
 * - Stdio（默认）：spawn 子进程，createEnvClient(StdioClientTransport)
 * - HTTP 远程：ENV_MCP_HTTP_URL 指向已启动的 env-mcp-server-http，createEnvClient(StreamableHTTPClientTransport)
 *
 * 用法:
 *   bun run examples/env-client-test.ts
 *   bun run examples/env-client-test.ts -- examples/env-mcp-server.ts   # 指定 stdio server 脚本
 *   ENV_MCP_SERVER=examples/env-mcp-server.ts bun run examples/env-client-test.ts
 *   ENV_MCP_HTTP_URL=http://localhost:3000 bun run examples/env-client-test.ts   # HTTP 远程模式（需先启动 env-mcp-server-http.ts）
 */

import {
  createEnvClient,
  EnvClient,
  StdioClientTransport,
  StreamableHTTPClientTransport,
  type Transport,
} from "../packages/core/src/env_spec/client.js";

const DEFAULT_SERVER_SCRIPT = "examples/env-mcp-server.ts";

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
  } catch (err: unknown) {
    console.log("❌ Failed:", err instanceof Error ? err.message : err);
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
  } catch (err: unknown) {
    console.log("❌ Failed:", err instanceof Error ? err.message : err);
  }

  // Test 3: Get Profile
  console.log("\nTest 3: Get Specific Profile");
  console.log("----------------------------------------");
  try {
    const profile = await client.getProfile("default");
    console.log("✅ Success");
    console.log(`   Profile: ${profile.displayName}`);
    console.log(`   Agents:`, profile.primaryAgents.map((a) => a.id).join(", "));
  } catch (err: unknown) {
    console.log("❌ Failed:", err instanceof Error ? err.message : err);
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
  } catch (err: unknown) {
    console.log("❌ Failed:", err instanceof Error ? err.message : err);
  }

  // Test 5: List Primary Agents
  console.log("\nTest 5: List Primary Agents Only");
  console.log("----------------------------------------");
  try {
    const agents = await client.listAgents({ role: "primary" });
    console.log("✅ Success");
    console.log(`   Found ${agents.length} primary agents`);
    agents.forEach((a) => console.log(`   - ${a.id}`));
  } catch (err: unknown) {
    console.log("❌ Failed:", err instanceof Error ? err.message : err);
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
  } catch (err: unknown) {
    console.log("❌ Failed:", err instanceof Error ? err.message : err);
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
  } catch (err: unknown) {
    console.log("❌ Failed:", err instanceof Error ? err.message : err);
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
  } catch (err: unknown) {
    console.log("❌ Failed:", err instanceof Error ? err.message : err);
  }

  // Test 9: Query Logs by Level
  console.log("\nTest 9: Query Logs by Level (error only)");
  console.log("----------------------------------------");
  try {
    const logs = await client.queryLogs({ level: "error" });
    console.log("✅ Success");
    console.log(`   Error logs: ${logs.length}`);
    logs.forEach((log) => console.log(`   ❌ ${log.message}`));
  } catch (err: unknown) {
    console.log("❌ Failed:", err instanceof Error ? err.message : err);
  }

  // Test 10: Query Logs with Limit
  console.log("\nTest 10: Query Logs with Limit");
  console.log("----------------------------------------");
  try {
    const logs = await client.queryLogs({ limit: 2 });
    console.log("✅ Success");
    console.log(`   Returned ${logs.length} logs (limited to 2)`);
  } catch (err: unknown) {
    console.log("❌ Failed:", err instanceof Error ? err.message : err);
  }

  console.log("\n========================================");
  console.log("  All Tests Completed!");
  console.log("========================================\n");
}

function getServerScript(): string {
  const fromEnv = process.env.ENV_MCP_SERVER;
  if (fromEnv) return fromEnv;
  const arg = process.argv.indexOf("--");
  if (arg !== -1 && process.argv[arg + 1]) return process.argv[arg + 1];
  return DEFAULT_SERVER_SCRIPT;
}

async function main() {
  const httpUrl = process.env.ENV_MCP_HTTP_URL;
  let transport: Transport;

  if (httpUrl) {
    console.log("🔌 Using MCP SDK StreamableHTTPClientTransport (HTTP 远程模式)");
    console.log(`   URL: ${httpUrl}\n`);
    transport = new StreamableHTTPClientTransport(new URL(httpUrl));
    // connect() 会自动调用 transport.start()，无需在此 start
  } else {
    const serverScript = getServerScript();
    console.log("🔌 Using MCP SDK StdioClientTransport");
    console.log(`   Spawning: bun run ${serverScript}\n`);
    transport = new StdioClientTransport({
      command: "bun",
      args: ["run", serverScript],
    });
  }

  const envClient = await createEnvClient(transport);

  try {
    await runTests(envClient);
  } finally {
    console.log("🧹 Closing transport...");
    await transport.close();
    console.log("✅ Done!");
  }
}

main().catch(console.error);
