/**
 * @fileoverview Run Command
 *
 * 直接运行代理任务
 */

import { CommandModule } from "yargs";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
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

function findBun(): string | null {
  const bunNames = process.platform === "win32" ? ["bun.exe", "bun"] : ["bun"];

  const searchDirs = [
    process.env.BUN_INSTALL,
    process.env.npm_config_prefix && path.join(process.env.npm_config_prefix, "bun"),
    path.join(process.env.APPDATA || "", "npm"),
    path.join(process.env.USERPROFILE || "", ".bun"),
    path.join(process.env.USERPROFILE || "", "AppData", "Roaming", "npm"),
    process.env.HOME && path.join(process.env.HOME, ".bun"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ].filter(Boolean) as string[];

  for (const dir of searchDirs) {
    if (dir && fs.existsSync(dir)) {
      for (const bunName of bunNames) {
        const bunPath = path.join(dir, bunName);
        if (fs.existsSync(bunPath)) {
          return bunPath;
        }
      }
    }
  }

  return null;
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

    const port = args.port;
    const url = `http://localhost:${port}`;
    console.log("🚀 启动 tong_work 服务器...");

    const workdir = process.cwd();
    const serverScript = path.join(workdir, "packages", "app", "server", "src", "index.ts");
    const envFile = path.join(workdir, ".env");

    const baseEnv = await loadEnvFile(envFile);

    const env = {
      ...process.env,
      ...baseEnv,
      PORT: String(port),
      LLM_MODEL: args.model || baseEnv.LLM_MODEL || "",
      LLM_API_KEY: baseEnv.LLM_API_KEY || "",
      LLM_BASE_URL: baseEnv.LLM_BASE_URL || "",
    };

    const bunPath = findBun();
    if (!bunPath) {
      console.error("❌ 未找到 bun 运行时");
      console.error("请确保 Bun 已安装并添加到 PATH");
      console.error("安装: https://bun.sh");
      process.exit(1);
    }

    console.log(`使用 bun: ${bunPath}`);

    const serverProc = spawn(bunPath, ["run", serverScript], {
      cwd: workdir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let serverReady = false;

    serverProc.stdout?.on("data", (data) => {
      const msg = data.toString();
      process.stdout.write(msg);
      if (msg.includes("Server running at") || msg.includes("按 Ctrl+C")) {
        serverReady = true;
      }
    });

    serverProc.stderr?.on("data", (data) => {
      process.stderr.write(data.toString());
    });

    serverProc.on("error", (err) => {
      console.error("❌ 服务器启动失败:", err);
      process.exit(1);
    });

    serverProc.on("close", (code) => {
      if (code && serverReady) {
        process.exit(code);
      }
    });

    console.log(`⏳ 等待服务器启动 (${url})...`);

    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(async () => {
        try {
          const client = new TongWorkClient(url);
          const healthy = await client.healthCheck();
          if (healthy) {
            clearInterval(checkInterval);
            console.log("✅ 服务器已就绪\n");
            resolve();
          }
        } catch {
          // Server not ready yet
        }
      }, 500);

      setTimeout(() => {
        clearInterval(checkInterval);
        if (!serverReady) {
          console.error("❌ 服务器启动超时");
          serverProc.kill();
          process.exit(1);
        }
      }, 30000);
    });

    try {
      const client = new TongWorkClient(url, { sessionId: args.session });

      if (args.continue && args.session) {
        const messages = await client.getMessages(args.session);
        if (messages.length === 0) {
          console.error("会话不存在或没有消息");
          serverProc.kill();
          process.exit(1);
        }
        console.log(`继续会话: ${args.session}\n`);
      } else {
        const session = await client.createSession();
        args.session = session.id;
        console.log(`创建新会话: ${session.id}\n`);
      }

      await client.runInteractive(args.session!, message);

      console.log("👋 任务完成，关闭服务器...");
      serverProc.kill();
      process.exit(0);
    } catch (error) {
      console.error("❌ 执行失败:", error);
      serverProc.kill();
      process.exit(1);
    }
  },
};
