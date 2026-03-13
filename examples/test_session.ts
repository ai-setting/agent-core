#!/usr/bin/env bun
/**
 * Session Traced 日志测试脚本
 * 
 * Usage:
 *   LOG_LEVEL=debug bun run examples/test_session.ts
 */

import { ServerEnvironment } from "../packages/core/src/server/environment.js";
import { Session, Storage } from "../packages/core/src/core/session/index.js";

async function main() {
  process.env.EVENTSOURCE_POLLING_ENABLED = "false";

  console.log("==============================================");
  console.log("    Session Traced 日志测试");
  console.log("==============================================\n");

  console.log("注意: 请设置 LOG_LEVEL=debug 以查看 traced 日志输出\n");

  const env = new ServerEnvironment({});

  console.log("等待环境就绪...");
  await env.waitForReady();

  const model = env.getCurrentModel();
  console.log("✓ ServerEnvironment 就绪");
  console.log(`  Model: ${model?.providerID}/${model?.modelID}\n`);

  const session = Session.create({ 
    title: "Traced Test Session",
    directory: process.cwd()
  });

  console.log("✓ 新 Session 已创建:", session.id);
  console.log("  Title:", session.title);
  console.log("");

  const query = "你好";

  const history = await session.toHistory();
  console.log("【Step 1】toHistory() 已调用 (查看日志跟踪)");
  console.log(`  返回消息数: ${history.length}\n`);

  session.addUserMessage(query);
  console.log("【Step 2】addUserMessage() 已调用 (查看日志跟踪)\n");

  console.log("【Step 3】调用 handle_query() (查看完整调用链)");
  console.log("  这会触发以下 Session 相关方法:");
  console.log("  - session.getMessages() / session.toHistory()");
  console.log("  - session.addMessage()");
  console.log("  - session.addMessageFromModelMessage()");
  console.log("  - session.updateContextUsage()");
  console.log("  - 等...\n");

  try {
    const response = await env.handle_query(query, {
      session_id: session.id,
      onMessageAdded: (message) => {
        console.log(`[onMessageAdded] role=${message.role}`);
        session.addMessageFromModelMessage(message);
      }
    }, history);

    console.log("\n【Response】");
    console.log(response);
  } catch (error) {
    console.error("\n【Error】", error);
  }

  console.log("\n==============================================");
  console.log("    测试完成!");
  console.log("==============================================");
  console.log("\n请检查日志文件中的 traced 输出:");
  console.log("  - 日志路径: ~/.local/share/tong_work/logs/server.log");
  console.log("  - 搜索: LOG_LEVEL=debug bun run ...\n");

  process.exit(0);
}

main().catch(console.error);
