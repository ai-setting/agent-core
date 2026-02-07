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

interface RunOptions {
  message?: string;
  continue?: boolean;
  session?: string;
  model?: string;
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
  command: "run <message>",
  describe: "直接运行代理任务",
  builder: (yargs) =>
    yargs
      .positional("message", {
        describe: "要执行的消息",
        type: "string",
        demandOption: true,
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
      .option("model", {
        describe: "使用的模型",
        type: "string",
      })
      .option("port", {
        describe: "服务器端口",
        type: "number",
        default: 4096,
      }),

  async handler(args) {
    const message = args.message || "";

    if (!message && !args.continue && !args.session) {
      console.error("请提供要执行的消息");
      process.exit(1);
    }

    const workdir = process.cwd();
    const envFile = path.join(workdir, ".env");
    const baseEnv = await loadEnvFile(envFile);

    // 设置环境变量
    const model = args.model || baseEnv.LLM_MODEL || "";
    const apiKey = baseEnv.LLM_API_KEY || "";
    const baseURL = baseEnv.LLM_BASE_URL || "";
    const port = args.port;

    console.log("🚀 启动 tong_work 服务器...");

    // 创建环境（不依赖外部 bun）
    let env: ServerEnvironment | undefined;
    if (model && apiKey) {
      try {
        env = new ServerEnvironment({
          model,
          apiKey,
          baseURL,
        });
        console.log(`✅ Environment 已创建 (Model: ${model})`);
      } catch (error) {
        console.error("❌ 创建 Environment 失败:", error);
        process.exit(1);
      }
    } else {
      console.log("⚠️  未配置 LLM，Server 将以简化模式运行");
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
    const client = new TongWorkClient("http://localhost:4096", { 
      sessionId: args.session,
      // @ts-ignore - 注入本地 fetch
      fetch: localFetch,
    });

    console.log("✅ 服务器已就绪\n");

    try {
      if (args.continue && args.session) {
        const messages = await client.getMessages(args.session);
        if (messages.length === 0) {
          console.error("会话不存在或没有消息");
          process.exit(1);
        }
        console.log(`继续会话: ${args.session}\n`);
      } else {
        const session = await client.createSession();
        args.session = session.id;
        console.log(`创建新会话: ${session.id}\n`);
      }

      await client.runInteractive(args.session!, message);

      console.log("\n👋 任务完成！");
      process.exit(0);
    } catch (error) {
      console.error("❌ 执行失败:", error);
      process.exit(1);
    }
  },
};
