/**
 * @fileoverview Serve Command
 *
 * 启动 headless tong_work 服务器
 */

import { CommandModule } from "yargs";
import { initServer } from "../../server/index.js";
import fs from "fs";
import path from "path";

interface ServeOptions {
  port?: number;
  host?: string;
}

export const ServeCommand: CommandModule<object, ServeOptions> = {
  command: "serve",
  describe: "启动 headless tong_work 服务器",
  builder: (yargs) =>
    yargs
      .option("port", {
        describe: "服务器端口",
        type: "number",
        default: 4096,
      })
      .option("host", {
        describe: "服务器主机",
        type: "string",
        default: "0.0.0.0",
      }),

  async handler(args) {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║     tong_work Server                                      ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log();

    // 初始化 Server（注册命令、加载配置、创建 Environment）
    const { port: actualPort, server, env } = await initServer({
      port: args.port,
      hostname: args.host,
    });

    console.log();
    console.log("使用 tong_work attach 连接:");
    console.log(`  tong_work attach http://${args.host}:${actualPort}`);
    console.log();
    console.log("按 Ctrl+C 停止");

    // 等待退出信号
    await new Promise<void>((resolve) => {
      const cleanup = async () => {
        console.log("\n正在关闭服务器...");
        try {
          // 调用 server.stop() 清理 MCP 连接
          if (server) {
            await server.stop();
          }
        } catch (error) {
          console.error("关闭时出错:", error);
        }
        resolve();
      };

      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
    });
  },
};
