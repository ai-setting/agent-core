/**
 * @fileoverview Session Command
 *
 * tong_work session 命令 - Session 管理命令 (list, grep, read)
 * 支持离线模式，直接从 Storage 读取数据
 * 使用统一的过滤组件 (session-filter.ts)
 */

import { CommandModule } from "yargs";
import { TongWorkClient } from "../client.js";
import { 
  filterSessions, 
  filterMessages, 
  searchMessages,
  parseTimeRange 
} from "../session-filter.js";

interface SessionOptions {
  type: "list" | "grep" | "read" | "help";
  session?: string;
  query?: string;
  limit?: number;
  startTime?: string;
  endTime?: string;
  port?: number;
  offline?: boolean;
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
  --offline       离线模式，直接从本地存储读取（不需要服务器）

Examples:
  # 离线列出所有 session（不需要服务器）
  tong_work session --type list --offline

  # 离线读取 session 消息
  tong_work session --type read --session <SESSION_ID> --offline
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

/**
 * 离线模式处理：直接从 Storage 读取
 */
async function handleOfflineMode(args: SessionOptions): Promise<void> {
  try {
    // 导入 Storage
    const { Storage } = await import("../../core/session/storage.js");

    // 初始化 Storage（如果需要）
    if (!Storage.initialized) {
      await Storage.initialize({ mode: "sqlite", autoSave: false });
    }

    const timeOptions = parseTimeRange(args.startTime, args.endTime);

    switch (args.type) {
      case "list": {
        const sessions = Storage.listSessionInfos(
          timeOptions.startTime || timeOptions.endTime
            ? { timeRange: { start: timeOptions.startTime, end: timeOptions.endTime } }
            : undefined,
          { limit: args.limit || 20 }
        );

        console.log("\nSessions (offline):\n");
        for (const s of sessions.sessions) {
          const created = s.time?.created ? new Date(s.time.created).toISOString() : "N/A";
          console.log(`  ${s.id} | ${s.title || "(无标题)"} | ${created}`);
        }
        console.log(`\nTotal: ${sessions.total}`);
        break;
      }

      case "read": {
        if (!args.session) {
          console.error("Error: --session is required for read");
          process.exit(1);
        }

        const session = Storage.getSession(args.session);
        if (!session) {
          console.error(`Error: Session not found: ${args.session}`);
          process.exit(1);
        }

        let messages = await session.getMessages();

        // 确保是数组
        let msgArray = Array.isArray(messages) ? messages : Array.from(messages);

        // 时间过滤
        if (timeOptions.startTime || timeOptions.endTime) {
          // 先按时间排序（确保时间顺序正确）
          msgArray.sort((a: any, b: any) => a.info.timestamp - b.info.timestamp);
          msgArray = msgArray.filter((m: any) => {
            const ts = m.info.timestamp;
            if (timeOptions.startTime && ts < timeOptions.startTime) return false;
            if (timeOptions.endTime && ts > timeOptions.endTime) return false;
            return true;
          });
        }

        // 限制数量
        if (args.limit && msgArray.length > args.limit) {
          msgArray = msgArray.slice(-args.limit);
        }

        console.log(`\n=== Session: ${args.session} ===\n`);
        for (const msg of msgArray as any[]) {
          const parts = msg.parts || [];
          const content = Array.isArray(parts)
            ? parts
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join("\n")
                .substring(0, 200)
            : "";
          console.log(`[${msg.info.role}] ${new Date(msg.info.timestamp).toISOString()}: ${content}`);
        }
        console.log(`\nTotal: ${msgArray.length}`);
        break;
      }

      case "grep": {
        if (!args.session || !args.query) {
          console.error("Error: --session and --query are required for grep");
          process.exit(1);
        }

        const session = Storage.getSession(args.session);
        if (!session) {
          console.error(`Error: Session not found: ${args.session}`);
          process.exit(1);
        }

        let messages = await session.getMessages();
        let msgArray = Array.isArray(messages) ? messages : Array.from(messages);

        // 时间过滤 (grep 也支持时间过滤)
        if (timeOptions.startTime || timeOptions.endTime) {
          // 先按时间排序
          msgArray.sort((a: any, b: any) => a.info.timestamp - b.info.timestamp);
          msgArray = msgArray.filter((m: any) => {
            const ts = m.info.timestamp;
            if (timeOptions.startTime && ts < timeOptions.startTime) return false;
            if (timeOptions.endTime && ts > timeOptions.endTime) return false;
            return true;
          });
        }

        const lowerQuery = args.query.toLowerCase();
        const matches: any[] = [];

        for (const msg of msgArray as any[]) {
          const parts = msg.parts || [];
          const content = Array.isArray(parts)
            ? parts
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join("\n")
                .toLowerCase()
            : "";

          if (content.includes(lowerQuery)) {
            matches.push(msg);
            if (matches.length >= (args.limit || 10)) break;
          }
        }

        console.log(`\n=== Grep results for "${args.query}" in ${args.session} ===\n`);
        console.log(`Found ${matches.length} matches:\n`);
        for (const msg of matches as any[]) {
          const msgParts = msg.parts || [];
          const content = Array.isArray(msgParts)
            ? msgParts
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join("\n")
                .substring(0, 200)
            : "";
          console.log(`[${msg.info.role}] ${new Date(msg.info.timestamp).toISOString()}: ${content}`);
        }
        console.log(`\nTotal matches: ${matches.length}`);
        break;
      }

      default:
        showHelp();
    }
  } catch (error) {
    console.error(`Error in offline mode: ${error}`);
    process.exit(1);
  }
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
      offline: {
        describe: "离线模式，直接从本地存储读取（不需要服务器）",
        type: "boolean",
        default: false,
      },
    }),

  async handler(argv) {
    const args = argv as SessionOptions;

    // 离线模式：直接从 Storage 读取
    if (args.offline) {
      return handleOfflineMode(args);
    }

    // 在线模式：通过 HTTP API
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
