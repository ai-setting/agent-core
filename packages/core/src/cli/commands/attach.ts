/**
 * @fileoverview Attach Command
 *
 * 附加到运行中的 tong_work 服务器
 */

import { CommandModule } from "yargs";
import { TongWorkClient } from "../client.js";

interface AttachOptions {
  url: string;
  dir?: string;
  session?: string;
  password?: string;
}

export const AttachCommand: CommandModule<object, AttachOptions> = {
  command: "attach <url>",
  describe: "附加到运行中的 tong_work 服务器",
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

    const healthy = await client.healthCheck();
    if (!healthy) {
      console.error(`❌ 无法连接到服务器: ${args.url}`);
      console.error("请确保服务器正在运行");
      process.exit(1);
    }

    console.log(`✅ 已连接到 ${args.url}`);

    if (args.session) {
      console.log(`会话: ${args.session}\n`);
    } else {
      const sessions = await client.listSessions();
      if (sessions.length > 0) {
        console.log("可用会话:");
        for (const s of sessions.slice(0, 5)) {
          console.log(`  - ${s.id} (${s.title || "无标题"})`);
        }
        console.log("");
      }
    }

    console.log("=== tong_work 交互模式 ===");
    console.log("输入消息与 AI 对话，输入 'exit' 退出，输入 'new' 创建新会话\n");

    const readline = await import("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    let currentSession = args.session;

    const sendMessage = async (msg: string) => {
      if (!currentSession) {
        const session = await client.createSession();
        currentSession = session.id;
        console.log(`创建新会话: ${currentSession}\n`);
      }
      await client.runInteractive(currentSession, msg);
    };

    if (args.session) {
      await sendMessage("继续对话");
    }

    const ask = () => {
      rl.question("> ", async (input) => {
        const trimmed = input.trim();

        if (trimmed.toLowerCase() === "exit") {
          console.log("再见！");
          rl.close();
          process.exit(0);
        }

        if (trimmed.toLowerCase() === "new") {
          currentSession = undefined;
          console.log("新会话已创建\n");
          ask();
          return;
        }

        if (trimmed) {
          await sendMessage(trimmed);
        }

        ask();
      });
    };

    ask();
  },
};
