#!/usr/bin/env bun
/**
 * @fileoverview Interactive Chat Demo with OsEnv
 *
 * Features:
 * - Interactive LLM chat with real-time responses
 * - Session management and compaction
 * - Auto-compaction based on message threshold
 *
 * Usage:
 *   Interactive: bun run examples/chat-demo.ts
 *   Pipe mode: echo "你的问题" | bun run examples/chat-demo.ts
 */

import { Session, SessionCompaction, Storage, OsEnv } from "../src/index.js";

interface CompactionConfig {
  maxMessages: number;
  autoCompact: boolean;
}

async function loadEnvConfig(path: string): Promise<void> {
  try {
    const text = await Bun.file(path).text();
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          const value = trimmed.substring(eqIndex + 1).trim();
          if (value) process.env[key] = value;
        }
      }
    }
  } catch {}
}

function printHelp(): void {
  console.log(`
命令:
  /compact    - 手动压缩对话
  /history    - 查看消息历史
  /status     - 查看会话状态
  /auto on|off - 开启/关闭自动压缩
  /help       - 显示此帮助
  /quit       - 退出程序
`);
}

async function showHistory(session: Session): Promise<void> {
  console.log(`\n[历史 ${session.messageCount} 条]\n`);
  const messages = session.getMessages();
  messages.forEach((msg, idx) => {
    const role = msg.info.role.toUpperCase().padEnd(10);
    const text = (msg.parts[0] as any)?.text?.substring(0, 80) ?? "";
    console.log(`[${idx + 1}] [${role}] ${text}${text.length > 80 ? "..." : ""}`);
  });
}

async function showStatus(session: Session, config: CompactionConfig): Promise<void> {
  const status = await SessionCompaction.getStatus(session, { maxMessages: config.maxMessages });
  console.log(`\n[状态] 消息: ${session.messageCount} | 预估Token: ${status.tokenCount} | 自动压缩: ${config.autoCompact ? "开" : "关"}`);
}

async function handleCompact(session: Session, config: CompactionConfig): Promise<Session | null> {
  console.log(`\n[压缩中...]`);

  const result = await SessionCompaction.process(session, undefined, {
    keepMessages: 3,
  });

  if (result.success && result.session) {
    const rate = ((1 - result.session.messageCount / result.originalMessageCount) * 100).toFixed(1);
    console.log(`[压缩完成] ${result.originalMessageCount} → ${result.session.messageCount} (${rate}%)`);
    if (result.summary) console.log(`  摘要: ${result.summary.substring(0, 80)}...`);
    return result.session;
  }

  console.log(`[压缩失败]`);
  return null;
}

async function handleCommand(
  cmd: string,
  session: Session,
  config: CompactionConfig
): Promise<{ newSession?: Session; exit?: boolean }> {
  const parts = cmd.toLowerCase().trim().split(/\s+/);
  const mainCmd = parts[0];

  switch (mainCmd) {
    case "/compact":
    case "/c": {
      const newSession = await handleCompact(session, config);
      if (newSession) return { newSession };
      break;
    }

    case "/history":
    case "/h":
      await showHistory(session);
      break;

    case "/status":
    case "/st":
      await showStatus(session, config);
      break;

    case "/auto": {
      const value = parts[1]?.toLowerCase();
      if (value === "on") {
        config.autoCompact = true;
        console.log("[自动压缩已开启]");
      } else if (value === "off") {
        config.autoCompact = false;
        console.log("[自动压缩已关闭]");
      } else {
        console.log("[用法: /auto on|off]");
      }
      break;
    }

    case "/help":
    case "/?":
      printHelp();
      break;

    case "/quit":
    case "/q":
      console.log("\n再见!");
      return { exit: true };
  }

  return {};
}

async function readLine(): Promise<string> {
  if (process.stdin.isTTY) {
    const rl = await import("node:readline");
    return new Promise((resolve) => {
      const iface = rl.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      iface.question("你: ", (ans) => {
        iface.close();
        resolve(ans.trim());
      });
    });
  } else {
    const text = await new Response(Bun.stdin).text();
    return text.trim();
  }
}

async function main(): Promise<void> {
  await loadEnvConfig(".env");

  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;

  if (!model || !apiKey) {
    console.log("请在 .env 中配置 LLM_MODEL 和 LLM_API_KEY");
    process.exit(1);
  }

  const env = await OsEnv.create();

  let session = Session.create({ title: "Chat", directory: process.cwd() });
  const config: CompactionConfig = { maxMessages: 10, autoCompact: true };

  console.clear();
  console.log("╔════════════════════════════════════════════╗");
  console.log("║         Chat - LLM 交互对话              ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log(`Model: ${model}`);
  console.log(`工具: ${env.listTools().map(t => t.name).join(", ")}`);
  printHelp();

  while (true) {
    const input = await readLine();
    if (!input) continue;

    if (input.startsWith("/")) {
      const result = await handleCommand(input, session, config);
      if (result.exit) break;
      if (result.newSession) {
        session = result.newSession;
        console.log(`\n[Session ${session.id}]`);
      }
      continue;
    }

    session.addUserMessage(input);

    try {
      const history = session.toHistory();
      const response = await env.handle_query(input, {}, history);
      session.addAssistantMessage(response);

      console.log(`\n🤖 ${response}\n`);

      const status = await SessionCompaction.getStatus(session, { maxMessages: config.maxMessages });
      if (status.needsCompaction && config.autoCompact) {
        const newSession = await handleCompact(session, config);
        if (newSession) session = newSession;
      }
    } catch (error) {
      console.log(`\n[错误] ${error}`);
    }
  }

  Storage.clear();
}

main().catch(console.error);
