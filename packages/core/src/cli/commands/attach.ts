/**
 * @fileoverview Attach Command
 *
 * 附加到运行中的 tong_work 服务器（TUI 版本）
 */

import { CommandModule } from "yargs";
import { TongWorkClient } from "../client.js";
import { startTUI } from "../tui/index.js";

interface AttachOptions {
  url: string;
  dir?: string;
  session?: string;
  password?: string;
}

export const AttachCommand: CommandModule<object, AttachOptions> = {
  command: "attach <url>",
  describe: "附加到运行中的 tong_work 服务器（TUI 模式）",
  builder: (yargs) =>
    yargs
      .positional("url", {
        describe: "服务器地址",
        type: "string",
        demandOption: true,
      })
      .option("session", {
        alias: "s",
        describe: "继续指定会话",
        type: "string",
      })
      .option("password", {
        alias: "p",
        describe: "认证密码",
        type: "string",
      }),

  async handler(args) {
    const client = new TongWorkClient(args.url, {
      sessionId: args.session,
      password: args.password,
    });

    // 检查服务器健康状态
    const healthy = await client.healthCheck();
    if (!healthy) {
      console.error(`❌ 无法连接到服务器: ${args.url}`);
      console.error("请确保服务器正在运行");
      process.exit(1);
    }

    // 启动 TUI
    const cleanup = await startTUI({
      url: args.url,
      sessionID: args.session,
      password: args.password,
    });

    // 保持进程运行
    await new Promise(() => {
      // 等待中断信号
    });

    // 清理（这行实际上不会执行，因为上面是无限等待）
    cleanup();
  },
};
