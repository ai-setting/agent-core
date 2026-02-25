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
    const { port: actualPort } = await initServer({
      port: args.port,
      hostname: args.host,
    });

    console.log();
    console.log("使用 tong_work attach 连接:");
    console.log(`  tong_work attach http://${args.host}:${actualPort}`);
    console.log();
    console.log("按 Ctrl+C 停止");

    await new Promise(() => {});
  },
};
