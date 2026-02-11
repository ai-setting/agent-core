/**
 * @fileoverview Agent Core Server Entry Point
 *
 * HTTP Server with SSE support for agent-core framework.
 */

import { AgentServer } from "./server.js";
import { ServerEnvironment } from "./environment.js";
import { serverLogger, sessionLogger, sseLogger } from "./logger.js";
import { CommandRegistry } from "./command/index.js";
import { echoCommand } from "./command/built-in/echo.js";

async function main() {
  // 立即测试所有 logger
  console.log("[DEBUG] Logger test START");
  console.log("[DEBUG] LOG_LEVEL:", process.env.LOG_LEVEL);
  console.log("[DEBUG] Testing serverLogger...");
  serverLogger.info("TEST ENTRY - serverLogger working");
  console.log("[DEBUG] Testing sessionLogger...");
  sessionLogger.info("TEST ENTRY - sessionLogger working");
  console.log("[DEBUG] Testing sseLogger...");
  sseLogger.info("TEST ENTRY - sseLogger working");
  console.log("[DEBUG] Logger test END");

  const port = parseInt(process.env.PORT || "3000");
  const hostname = process.env.HOSTNAME || "0.0.0.0";
  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL;

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     Agent Core Server                                      ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log();

  // 注册内置 Commands
  console.log("📝 注册 Commands...");
  const commandRegistry = CommandRegistry.getInstance();
  commandRegistry.register(echoCommand);
  console.log(`✅ 已注册 ${commandRegistry.list().length} 个命令`);
  console.log();

  let env: ServerEnvironment | undefined;

  if (model && apiKey) {
    console.log("🔄 初始化 ServerEnvironment...");
    env = new ServerEnvironment({
      model,
      apiKey,
      baseURL,
    });
    console.log(`✅ Environment 已创建 (Model: ${model})`);
    console.log();
  } else {
    console.log("⚠️  LLM 未配置，Server 将以简化模式运行");
    console.log("   设置 LLM_MODEL 和 LLM_API_KEY 启用完整功能");
    console.log();
  }

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
