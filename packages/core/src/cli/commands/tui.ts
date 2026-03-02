/**
 * @fileoverview Default Command - TUI 交互模式
 *
 * 直接运行 tong_work 启动 TUI + 内嵌 Server
 */

import { CommandModule } from "yargs";
import { initServer } from "../../server/index.js";
import { TongWorkClient } from "../client.js";
import { startTUI } from "../tui/index.js";
import fs from "fs";
import path from "path";

interface TuiOptions {
  model?: string;
  session?: string;
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
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          if (key && value) result[key] = value;
        }
      }
    }
  } catch {}
  return result;
}

export const TuiCommand: CommandModule<object, TuiOptions> = {
  command: "$0 [args]",
  describe: "启动 tong_work TUI 交互界面",
  builder: (yargs) =>
    yargs
      .option("model", {
        alias: "m",
        describe: "使用的模型",
        type: "string",
      })
      .option("session", {
        alias: "s",
        describe: "继续指定会话",
        type: "string",
      })
      .option("port", {
        alias: "p",
        describe: "服务器端口",
        type: "number",
        default: 4096,
      })
      .option("continue", {
        alias: "c",
        describe: "继续上次会话",
        type: "boolean",
        default: false,
      })
      .positional("args", {
        describe: "可选参数",
        type: "string",
        default: "",
      }),

  async handler(args) {
    const workdir = process.cwd();

    const envPaths = [
      path.join(workdir, ".env"),
      path.join(workdir, "..", "..", ".env"),
      path.join(workdir, "..", ".env"),
    ];

    let baseEnv: Record<string, string> = {};
    for (const envPath of envPaths) {
      baseEnv = await loadEnvFile(envPath);
      if (Object.keys(baseEnv).length > 0) {
        console.log(`Loaded env from: ${envPath}`);
        break;
      }
    }

    console.log("🚀 启动 tong_work...");

    // 初始化 Server（注册命令、加载配置、创建 Environment）
    const { server, env, port: actualPort } = await initServer({
      port: args.port || 4096,
      hostname: "localhost",
      model: args.model,
      enableLogger: false,
    });

    const serverUrl = `http://localhost:${actualPort}`;

    console.log(`✅ 服务器已启动: ${serverUrl}`);
    console.log("🚀 启动 TUI 界面...\n");

    const client = new TongWorkClient(serverUrl, {
      sessionId: args.session,
    });

    if (args.continue && args.session) {
      const messages = await client.getMessages(args.session);
      if (messages.length === 0) {
        console.error("会话不存在或没有消息");
      } else {
        console.log(`继续会话: ${args.session}`);
      }
    }

    const stopServer = async () => {
      console.log("\n🛑 正在停止服务器...");
      
      // 停止 HTTP 服务器（内部会自动断开 EventSource）
      await server.stop();
      console.log("✓ 服务器已停止");
    };

    await startTUI({
      url: serverUrl,
      sessionID: args.session,
      onExit: async () => {
        await stopServer();
        console.log("\n👋 再见!");
        process.exit(0);
      },
    });

    await new Promise(() => {});
  }
};
