/**
 * @fileoverview Agent Core Server Entry Point
 *
 * HTTP Server with SSE support for agent-core framework.
 */

import { AgentServer } from "./server.js";
import { ServerEnvironment } from "./environment.js";
import { serverLogger, sessionLogger, sseLogger } from "./logger.js";
import { getLogDir, setLogDirOverride, setLoggerGlobalLevel, type LogLevel } from "../utils/logger.js";
import { CommandRegistry } from "./command/index.js";
import { echoCommand } from "./command/built-in/echo.js";
import { connectCommand } from "./command/built-in/connect.js";
import { modelsCommand } from "./command/built-in/models.js";
import { agentEnvCommand } from "./command/built-in/agent-env.js";
import { exitCommand } from "./command/built-in/exit.js";
import { sessionsCommand } from "./command/built-in/sessions.js";
import { memoryCommand } from "./command/built-in/memory.js";
import { Config_get, resolveConfig } from "../config/index.js";

export interface ServerInitOptions {
  port?: number;
  hostname?: string;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  enableLogger?: boolean;
}

export interface ServerInitResult {
  server: AgentServer;
  env: ServerEnvironment | undefined;
  port: number;
}

/**
 * 初始化 Server（注册命令、加载配置、创建 Environment）
 * 供 CLI 命令和 server/index.ts 共同使用
 */
export async function initServer(options: ServerInitOptions = {}): Promise<ServerInitResult> {
  const port = options.port ?? (parseInt(process.env.PORT || "3000"));
  const hostname = options.hostname ?? (process.env.HOSTNAME || "0.0.0.0");

  // 注册内置 Commands（如果尚未注册）
  const commandRegistry = CommandRegistry.getInstance();
  if (commandRegistry.list().length === 0) {
    serverLogger.info("📝 注册 Commands...");
    commandRegistry.register(echoCommand);
    commandRegistry.register(connectCommand);
    commandRegistry.register(modelsCommand);
    commandRegistry.register(agentEnvCommand);
    commandRegistry.register(exitCommand);
    commandRegistry.register(sessionsCommand);
    commandRegistry.register(memoryCommand);
    serverLogger.info(`✅ 已注册 ${commandRegistry.list().length} 个命令`);
  }

  // 加载配置
  let model = options.model;
  let apiKey = options.apiKey;
  let baseURL = options.baseURL;
  
  try {
    const rawConfig = await Config_get();
    const config = await resolveConfig(rawConfig);
    
    // 应用 logging 配置
    if (config.logging?.path) {
      setLogDirOverride(config.logging.path);
    }
    
    // 应用日志级别配置
    if (config.logging?.level) {
      setLoggerGlobalLevel(config.logging.level as LogLevel);
      serverLogger.info(`[Config] Log level set to: ${config.logging.level}`);
    }
    
    if (!model && config.defaultModel) model = config.defaultModel;
    if (!apiKey && config.apiKey) apiKey = config.apiKey;
    if (!baseURL && config.baseURL) baseURL = config.baseURL;
    
    // 将 clientId 注入环境变量，供 MCP Server 使用
    if (config.clientId) {
      process.env.CLIENT_ID = config.clientId;
      serverLogger.info(`[Config] CLIENT_ID set to: ${config.clientId}`);
    } else {
      serverLogger.info(`[Config] CLIENT_ID not found in config`);
    }
    
    if (model && apiKey) {
      serverLogger.info(`✅ 配置加载成功: ${model}`);
    }
  } catch (error) {
    serverLogger.warn("⚠️  配置加载失败:", error instanceof Error ? error.message : String(error));
  }

  // 创建 ServerEnvironment
  // 注意：不直接传入model/apiKey/baseURL，让ServerEnvironment通过loadFromConfig()
  // 使用模型选择链：recent > config > provider default
  let env: ServerEnvironment | undefined;
  try {
    env = new ServerEnvironment({});
    await env.waitForReady();
    const currentModel = env.getCurrentModel();
    if (currentModel) {
      serverLogger.info(`✅ Environment 已创建 (Model: ${currentModel.providerID}/${currentModel.modelID})`);
    } else {
      serverLogger.warn("⚠️  Environment 已创建，但未配置 LLM");
    }
  } catch (error) {
    serverLogger.error("❌ 创建 Environment 失败:", error instanceof Error ? error.message : String(error));
  }

  // 创建并启动 Server
  const server = new AgentServer({
    port,
    hostname,
    env,
    enableLogger: options.enableLogger,
  });

  const actualPort = await server.start();

  return { server, env, port: actualPort };
}

async function main() {
  // 打印日志目录
  serverLogger.info("[DEBUG] LOG_DIR: " + getLogDir());

  // 立即测试所有 logger
  serverLogger.info("[DEBUG] Logger test START");
  serverLogger.info("[DEBUG] LOG_LEVEL: " + process.env.LOG_LEVEL);
  serverLogger.info("[DEBUG] Testing serverLogger...");
  serverLogger.info("TEST ENTRY - serverLogger working");
  serverLogger.info("[DEBUG] Testing sessionLogger...");
  sessionLogger.info("TEST ENTRY - sessionLogger working");
  serverLogger.info("[DEBUG] Testing sseLogger...");
  sseLogger.info("TEST ENTRY - sseLogger working");
  serverLogger.info("[DEBUG] Logger test END");

  serverLogger.info("╔════════════════════════════════════════════════════════════╗");
  serverLogger.info("║     Agent Core Server                                      ║");
  serverLogger.info("╚════════════════════════════════════════════════════════════╝");

  const { port } = await initServer();

  serverLogger.info("按 Ctrl+C 停止服务");
}

// 只有直接运行此文件时才执行 main()
// 通过检查 import.meta.url 来判断是否是直接运行
if (import.meta.main) {
  main().catch(console.error);
}
