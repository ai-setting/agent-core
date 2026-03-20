/**
 * @fileoverview Session Command
 *
 * tong_work session 命令 - Session 管理命令 (list, grep, read)
 */

import { CommandModule } from "yargs";
import { TongWorkClient } from "../client.js";

interface SessionOptions {
  type: "list" | "grep" | "read" | "help";
  session?: string;
  query?: string;
  limit?: number;
  startTime?: string;
  endTime?: string;
  port?: number;
}

/**
 * 解析时间范围字符串
 * 格式: "2026-01-01" -> 当天 00:00:00
 * 格式: "2026-01-01 00:00:00" -> 精确时间
 */
function parseTimeRange(startTimeStr?: string, endTimeStr?: string): {
  startTime?: number;
  endTime?: number;
} {
  const result: { startTime?: number; endTime?: number } = {};

  if (startTimeStr) {
    const date = new Date(startTimeStr);
    if (isNaN(date.getTime())) {
      console.warn(`Invalid startTime format: ${startTimeStr}, expected "YYYY-MM-DD" or "YYYY-MM-DD HH:mm:ss"`);
    } else {
      // 如果只提供了日期，补全为当天开始
      if (!startTimeStr.includes(":")) {
        date.setHours(0, 0, 0, 0);
      }
      result.startTime = date.getTime();
    }
  }

  if (endTimeStr) {
    const date = new Date(endTimeStr);
    if (isNaN(date.getTime())) {
      console.warn(`Invalid endTime format: ${endTimeStr}, expected "YYYY-MM-DD" or "YYYY-MM-DD HH:mm:ss"`);
    } else {
      // 如果只提供了日期，补全为当天结束
      if (!endTimeStr.includes(":")) {
        date.setHours(23, 59, 59, 999);
      }
      result.endTime = date.getTime();
    }
  }

  return result;
}

function showHelp() {
  console.log(`
Session Command Help
====================

Usage: tong_work session [options]

Options:
  --type          操作类型: list, grep, read, help
  --session, -s   Session ID
  --query, -q     搜索关键词 (grep 用)
  --limit         返回数量限制 (默认: 20)
  --start-time    开始时间 (格式: YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss)
  --end-time      结束时间 (格式: YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss)
  --port          服务器端口 (默认: 4096)

Examples:
  # 列出所有 session
  tong_work session --type list

  # 列出当天的 session
  tong_work session --type list --start-time "2026-03-20"

  # 读取 session 消息
  tong_work session --type read --session <SESSION_ID>

  # 读取最近 10 条消息
  tong_work session --type read --session <SESSION_ID> --limit 10

  # 搜索 session 内容
  tong_work session --type grep --session <SESSION_ID> --query "关键词"

  # 搜索指定时间范围内的内容
  tong_work session --type grep --session <SESSION_ID> --query "关键词" --start-time "2026-03-19" --end-time "2026-03-20"
`);
}

export const SessionCommand: CommandModule<object, SessionOptions> = {
  command: "session",
  describe: "Session 管理命令 (list, grep, read)",
  builder: (yargs) =>
    yargs.options({
      type: {
        describe: "操作类型: list, grep, read, help",
        choices: ["list", "grep", "read", "help"],
        default: "help",
      },
      session: {
        describe: "Session ID",
        type: "string",
        alias: "s",
      },
      query: {
        describe: "搜索关键词 (grep 用)",
        type: "string",
        alias: "q",
      },
      limit: {
        describe: "返回数量限制",
        type: "number",
        default: 20,
      },
      "start-time": {
        describe: "开始时间 (格式: YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss)",
        type: "string",
      },
      "end-time": {
        describe: "结束时间 (格式: YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss)",
        type: "string",
      },
      port: {
        describe: "服务器端口",
        type: "number",
        default: 4096,
      },
    }),

  async handler(argv) {
    const args = argv as SessionOptions;

    const client = new TongWorkClient(`http://localhost:${args.port || 4096}`);

    switch (args.type) {
      case "help":
        showHelp();
        break;

      case "list": {
        try {
          let sessions = await client.listSessions();

          // 时间过滤
          if (args.startTime || args.endTime) {
            const timeOptions = parseTimeRange(args.startTime, args.endTime);
            sessions = sessions.filter((s) => {
              const created = new Date(s.createdAt).getTime();
              if (timeOptions.startTime && created < timeOptions.startTime) return false;
              if (timeOptions.endTime && created > timeOptions.endTime) return false;
              return true;
            });
          }

          console.log("\nSessions:\n");
          for (const s of sessions.slice(0, args.limit || 20)) {
            console.log(`  ${s.id} | ${s.title || "(无标题)"} | ${s.createdAt}`);
          }
          console.log(`\nTotal: ${sessions.length}`);
        } catch (error) {
          console.error(`Error: ${error}`);
          process.exit(1);
        }
        break;
      }

      case "read": {
        if (!args.session) {
          console.error("Error: --session is required for read");
          process.exit(1);
        }

        try {
          const timeOptions = parseTimeRange(args.startTime, args.endTime);
          const messages = await client.getMessages(args.session, {
            limit: args.limit,
            ...timeOptions,
          });

          console.log(`\n=== Session: ${args.session} ===\n`);
          for (const msg of messages) {
            console.log(`[${msg.role}] ${msg.timestamp}: ${msg.content.substring(0, 200)}`);
          }
          console.log(`\nTotal: ${messages.length}`);
        } catch (error) {
          console.error(`Error: ${error}`);
          process.exit(1);
        }
        break;
      }

      case "grep": {
        if (!args.session || !args.query) {
          console.error("Error: --session and --query are required for grep");
          process.exit(1);
        }

        try {
          const timeOptions = parseTimeRange(args.startTime, args.endTime);
          const messages = await client.getMessages(args.session, {
            limit: (args.limit || 10) * 10, // 获取更多消息以便过滤
            ...timeOptions,
          });

          const lowerQuery = args.query.toLowerCase();
          const matches: typeof messages = [];

          for (const msg of messages) {
            if (msg.content.toLowerCase().includes(lowerQuery)) {
              matches.push(msg);
              if (matches.length >= (args.limit || 10)) break;
            }
          }

          console.log(`\n=== Grep results for "${args.query}" in ${args.session} ===\n`);
          console.log(`Found ${matches.length} matches:\n`);
          for (const msg of matches) {
            console.log(`[${msg.role}] ${msg.timestamp}: ${msg.content.substring(0, 200)}`);
          }
          console.log(`\nTotal matches: ${matches.length}`);
        } catch (error) {
          console.error(`Error: ${error}`);
          process.exit(1);
        }
        break;
      }
    }
  },
};

export default SessionCommand;
