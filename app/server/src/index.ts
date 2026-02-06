/**
 * @fileoverview Agent Core Server Entry Point
 * 
 * HTTP Server with SSE support for agent-core framework.
 */

import { AgentServer } from "./server.js";
import { ServerEnvironment } from "./environment.js";

async function main() {
  // Load environment config
  const port = parseInt(process.env.PORT || "3000");
  const hostname = process.env.HOSTNAME || "0.0.0.0";
  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL;

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     Agent Core Server                                      ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log();

  // Create ServerEnvironment
  let env: ServerEnvironment | undefined;
  
  if (model && apiKey) {
    console.log("🔄 初始化 ServerEnvironment...");
    env = new ServerEnvironment({
      model,
      apiKey,
      baseURL,
    });
    console.log(`✅ Environment 已创建 (Model: ${model})`);
    console.log(`   Tools: ${env.listTools().map(t => t.name).join(", ")}`);
    console.log();
  } else {
    console.log("⚠️  LLM 未配置，Server 将以简化模式运行");
    console.log("   设置 LLM_MODEL 和 LLM_API_KEY 启用完整功能");
    console.log();
  }

  // Start HTTP Server
  const server = new AgentServer({
    port,
    hostname,
    env,
  });

  await server.start();

  console.log();
  console.log("按 Ctrl+C 停止服务");
}

main().catch(console.error);
