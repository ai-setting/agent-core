/**
 * @fileoverview Run Command
 *
 * 直接运行代理任务 - 内嵌服务器模式（不依赖外部 bun）
 * 参考 tongcode 的实现方式
 */

import { CommandModule } from "yargs";
import fs from "fs";
import path from "path";
import { AgentServer } from "../../server/server.js";
import { ServerEnvironment } from "../../server/environment.js";
import { TongWorkClient } from "../client.js";
import { Config_get, Config_reload, Config_clear, Config_getSync, Config_onChange, Config_notifyChange, resolveConfig } from "../../config/index.js";
import { findEnvironmentPath } from "../../config/sources/environment.js";
import { ConfigPaths } from "../../config/paths.js";

interface RunOptions {
  message?: string;
  continue?: boolean;
  session?: string;
  listSessions?: boolean;
  model?: string;
  env?: string;
  logFile?: string;
  port?: number;
}

async function loadEnvFile(filePath: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          let value = trimmed.substring(eqIndex + 1).trim();
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }
          if (key && value) result[key] = value;
        }
      }
    }
  } catch {}
  return result;
}

export const RunCommand: CommandModule<{}, RunOptions> = {
  command: "run [message]",
  describe: "直接运行代理任务",
  builder: (yargs) =>
    yargs
      .positional("message", {
        describe: "要执行的消息",
        type: "string",
      })
      .option("continue", {
        alias: "c",
        describe: "继续上次会话",
        type: "boolean",
        default: false,
      })
      .option("session", {
        alias: "s",
        describe: "指定会话 ID",
        type: "string",
      })
      .option("list-sessions", {
        alias: "l",
        describe: "列出所有会话",
        type: "boolean",
        default: false,
      })
      .option("model", {
        describe: "使用的模型",
        type: "string",
      })
      .option("env", {
        alias: "e",
        describe: "使用的环境名称",
        type: "string",
      })
      .option("quiet", {
        alias: "q",
        describe: "安静模式：日志只输出到文件，stdout 只显示 AI 响应",
        type: "boolean",
        default: false,
      })
      .option("port", {
        describe: "服务器端口",
        type: "number",
        default: 4096,
      }),

  async handler(args: any) {
    // message 可以是 undefined，所以我们不在这里验证
    const message = args.message || "";
    const isListSessions = args.listSessions;
    const hasMessage = !!message;
    const hasContinue = args.continue;
    const hasSession = !!args.session;

    // 验证参数组合
    if (!hasMessage && !isListSessions && !hasContinue && !hasSession) {
      console.error("请提供要执行的消息，或使用 --list-sessions 列出会话");
      process.exit(1);
    }

    // 处理 --quiet 参数：启用安静模式，日志只输出到文件
    // 需要在最早的时候执行，以便捕获所有日志
    let restoreConsole: (() => void) | undefined;
    if (args.quiet) {
      // 导入 logger 和 quietMode
      const { setQuietMode, logger } = await import("../../utils/logger.js");
      
      // 启用 quietMode
      setQuietMode(true);
      
      // 保存原始 console
      const originalLog = console.log;
      const originalInfo = console.info;
      const originalWarn = console.warn;
      const originalError = console.error;
      const originalDebug = console.debug;
      
      // 重写 console，将所有日志重定向到 logger
      console.log = (...args: any[]) => logger.info(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" "));
      console.info = (...args: any[]) => logger.info(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" "));
      console.warn = (...args: any[]) => logger.warn(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" "));
      console.error = (...args: any[]) => logger.error(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" "));
      console.debug = (...args: any[]) => logger.debug(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(" "));
      
      // 保存恢复函数
      restoreConsole = () => {
        console.log = originalLog;
        console.info = originalInfo;
        console.warn = originalWarn;
        console.error = originalError;
        console.debug = originalDebug;
      };
    }

    // 日志辅助函数
    const log = {
      info: (...args: any[]) => console.log(...args),
      warn: (...args: any[]) => console.warn(...args),
      error: (...args: any[]) => console.error(...args),
    };

    const workdir = process.cwd();

    // Try multiple locations for .env file
    const envPaths = [
      path.join(workdir, ".env"),
      path.join(workdir, "..", "..", ".env"), // From packages/core
      path.join(workdir, "..", ".env"),
    ];

    let baseEnv: Record<string, string> = {};
    for (const envPath of envPaths) {
      baseEnv = await loadEnvFile(envPath);
      if (Object.keys(baseEnv).length > 0) {
        log.info(`Loaded env from: ${envPath}`);
        break;
      }
    }

    log.info("🚀 启动 tong_work 服务器...");
    log.info("🔄 加载配置...");

    // 处理 --env 参数：设置 activeEnvironment
    let envName = args.env;
    if (envName) {
      log.info(`📦 查找环境: ${envName}`);
      const envPathInfo = await findEnvironmentPath(envName);
      if (!envPathInfo) {
        log.error(`❌ 环境 "${envName}" 未找到`);
        log.error(`   搜索路径: ${ConfigPaths.projectEnvironments}, ${ConfigPaths.environments}`);
        process.exit(1);
      }
      log.info(`   环境路径: ${envPathInfo.path} (${envPathInfo.source})`);

      // 设置 activeEnvironment 到 config
      const rawConfig = await Config_get();
      rawConfig.activeEnvironment = envName;
      rawConfig._environmentPath = envPathInfo.path;
      Config_notifyChange(rawConfig);
    }

    // 加载配置文件
    let configModel: string | undefined;
    let configApiKey: string | undefined;
    let configBaseURL: string | undefined;
    let configLoaded = false;

    try {
      const rawConfig = await Config_get();
      const config = await resolveConfig(rawConfig);

      // 应用 logging 配置
      if (config.logging?.path) {
        setLogDirOverride(config.logging.path);
        log.info(`📝 日志目录: ${config.logging.path}`);
      }

      if (config.defaultModel && config.apiKey) {
        configModel = config.defaultModel;
        configApiKey = config.apiKey;
        configBaseURL = config.baseURL;
        configLoaded = true;
        log.info(`✅ 配置加载成功: ${config.defaultModel}`);
      }
    } catch (error) {
      log.warn("⚠️  配置文件加载失败:", error instanceof Error ? error.message : String(error));
    }

    // 优先级：命令行参数 > .env 文件 > 配置文件
    const model = args.model || baseEnv.LLM_MODEL || configModel || "";
    const apiKey = baseEnv.LLM_API_KEY || configApiKey || "";
    const baseURL = baseEnv.LLM_BASE_URL || configBaseURL || "";
    const port = args.port;

    // Set environment variables for createLLMConfigFromEnv
    if (apiKey) process.env.LLM_API_KEY = apiKey;
    if (baseURL) process.env.LLM_BASE_URL = baseURL;

    // 创建环境（不依赖外部 bun）
    let env: ServerEnvironment | undefined;
    if (model && apiKey) {
      try {
        // 如果指定了 --env，需要重新加载配置以应用环境设置
        if (envName) {
          env = new ServerEnvironment({
            model,
            apiKey,
            baseURL,
            loadConfig: true, // 强制重新加载配置
          });
        } else {
          env = new ServerEnvironment({
            model,
            apiKey,
            baseURL,
          });
        }
        // Wait for initialization to complete
        await env.waitForReady();
        log.info(`✅ Environment 已创建 (Model: ${model})`);
      } catch (error) {
        log.error("❌ 创建 Environment 失败:", error);
        process.exit(1);
      }
    } else {
      log.warn("⚠️  未配置 LLM，Server 将以简化模式运行");
      if (!configLoaded) {
        log.warn("   请配置 auth.json 或设置 LLM_MODEL/LLM_API_KEY");
      }
    }

    // 创建服务器实例
    const server = new AgentServer({
      port,
      hostname: "localhost",
      env,
    });

    // 获取 Hono app 实例用于直接调用
    const app = server.getApp();

    // 创建本地 fetch 函数（直接调用，不通过 HTTP）
    const localFetch = async (input: any, init?: any): Promise<Response> => {
      const request = new Request(input, init);
      return app.fetch(request);
    };

    // 创建客户端，使用本地 fetch
    const client = new TongWorkClient(`http://localhost:${port}`, {
      sessionId: args.session,
      // @ts-ignore - 注入本地 fetch
      fetch: localFetch,
    });

    log.info(`✅ 服务器已就绪 (http://localhost:${port})\n`);

    // 恢复 console 用于 AI 响应输出
    if (args.logFile && (global as any).__restoreConsole) {
      (global as any).__restoreConsole();
    }

    try {
      // 处理 --list-sessions
      if (isListSessions) {
        const sessions = await client.listSessions();
        console.log("\n📋 会话列表:\n");
        if (sessions.length === 0) {
          console.log("  (无)");
        } else {
          for (const s of sessions) {
            const title = s.title || "(无标题)";
            const created = new Date(s.createdAt).toLocaleString("zh-CN");
            console.log(`  ${s.id}  - ${title} (创建于: ${created})`);
          }
        }
        console.log("");
        await server.stop();
        process.exit(0);
      }

      // 处理 --continue
      let sessionId = args.session;
      if (hasContinue && !sessionId) {
        // 获取最近使用的 session
        const sessions = await client.listSessions();
        if (sessions.length > 0) {
          // 按 updatedAt 排序，取最新的
          sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
          sessionId = sessions[0].id;
          console.log(`🔄 继续最近会话: ${sessionId}\n`);
        } else {
          console.error("没有可继续的会话");
          await server.stop();
          process.exit(1);
        }
      }

      // 创建或继续 session
      if (sessionId) {
        const messages = await client.getMessages(sessionId);
        if (messages.length === 0) {
          console.error("会话不存在或没有消息");
          await server.stop();
          process.exit(1);
        }
        console.log(`继续会话: ${sessionId}\n`);
      } else {
        const session = await client.createSession();
        sessionId = session.id;
        console.log(`创建新会话: ${session.id}\n`);
      }

      // 执行对话
      await client.runInteractive(sessionId!, message);

      console.log("\n👋 任务完成！");
      console.log(`Session: ${sessionId}`);
      await server.stop();
      process.exit(0);
    } catch (error) {
      console.error("❌ 执行失败:", error);
      await server.stop();
      process.exit(1);
    }
  },
};
