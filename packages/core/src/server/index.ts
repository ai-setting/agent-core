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
import { connectCommand } from "./command/built-in/connect.js";
import { modelsCommand } from "./command/built-in/models.js";
import { agentEnvCommand } from "./command/built-in/agent-env.js";
import { Config_get, resolveConfig } from "../config/index.js";

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

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     Agent Core Server                                      ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log();

  // 注册内置 Commands
  console.log("📝 注册 Commands...");
  const commandRegistry = CommandRegistry.getInstance();
  commandRegistry.register(echoCommand);
  commandRegistry.register(connectCommand);
  commandRegistry.register(modelsCommand);
  commandRegistry.register(agentEnvCommand);
  console.log(`✅ 已注册 ${commandRegistry.list().length} 个命令`);
  console.log();

  // 加载配置
  console.log("🔄 加载配置...");
  let configLoaded = false;
  let model: string | undefined;
  let env: ServerEnvironment | undefined;
  
  try {
    const rawConfig = await Config_get();
    const config = await resolveConfig(rawConfig);
    
    if (config.defaultModel && config.apiKey) {
      model = config.defaultModel;
      console.log(`✅ 配置加载成功`);
      console.log(`   Model: ${config.defaultModel}`);
      console.log(`   Provider: ${config.defaultModel.split("/")[0]}`);
      console.log(`   Base URL: ${config.baseURL}`);
      configLoaded = true;
    } else {
      console.log("⚠️  配置不完整，检查 auth.json 或环境变量");
    }
  } catch (error) {
    console.log("⚠️  配置加载失败:", error instanceof Error ? error.message : String(error));
  }
  console.log();

  // 创建 ServerEnvironment（优先从配置文件加载，支持环境变量覆盖）
  if (configLoaded || process.env.LLM_MODEL || process.env.LLM_API_KEY) {
    console.log("🔄 初始化 ServerEnvironment...");
    try {
      env = new ServerEnvironment({
        model: process.env.LLM_MODEL || model,
        apiKey: process.env.LLM_API_KEY,
        baseURL: process.env.LLM_BASE_URL,
      });
      await env.waitForReady();
      
      if ((env as any).llmConfig) {
        console.log(`✅ Environment 已创建 (LLM 已配置)`);
        console.log(`   Model: ${(env as any).llmConfig?.model || model}`);
      } else {
        console.log(`⚠️  Environment 已创建 (LLM 未配置)`);
        console.log("   配置 LLM 以启用 AI 功能");
      }
    } catch (error) {
      console.log("⚠️  ServerEnvironment 初始化失败:", error instanceof Error ? error.message : String(error));
      console.log("   Server 将以简化模式运行");
    }
    console.log();
  } else {
    console.log("⚠️  LLM 未配置，Server 将以简化模式运行");
    console.log("   配置 auth.json 或设置 LLM_MODEL/LLM_API_KEY 启用完整功能");
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
