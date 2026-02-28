/**
 * TaskTool 集成测试入口
 * 
 * 运行方式:
 *   bun run examples/simple-test.ts
 * 
 * 调试时可通过环境变量控制:
 *   EVENTSOURCE_POLLING_ENABLED=false 禁用轮询
 *   LOG_LEVEL=debug 输出 debug 日志
 *   LOG_TO_FILE=false 禁用文件日志，只输出到 stdout
 */

import { ServerEnvironment } from "../packages/core/src/server/environment.js";

async function main() {
  process.env.EVENTSOURCE_POLLING_ENABLED = "false";

  console.log("==============================================");
  console.log("    TaskTool 集成测试");
  console.log("==============================================\n");

  const env = new ServerEnvironment({});
  await env.waitForReady();
  
  const model = env.getCurrentModel();
  console.log("✓ ServerEnvironment 就绪");
  console.log(`  Model: ${model?.providerID}/${model?.modelID}\n`);

  // 创建父 Session
  const parentSession = env.createSession({ title: "Test Parent Session" });
  console.log("✓ 父 Session 已创建:", parentSession.id, "\n");

  // 测试通过主 Agent 调用 task tool
  console.log("【测试 1: 简单计算】");
  console.log("Prompt: 请使用 task tool 计算 1+1 = ?\n");
  
  await env.handle_query("请使用 task tool 计算 1+1 = ?", {
    session_id: parentSession.id,
    onMessageAdded: (message) => {
      console.log(`[onMessageAdded] role=${message.role}, content=${JSON.stringify(message.content).substring(0, 100)}...`);
      parentSession.addMessageFromModelMessage(message);
    }
  });

  // 等待事件处理
  await new Promise(r => setTimeout(r, 2000));

  // 检查父 session 的消息
  console.log("\n【父 Session 消息列表】");
  const parentMessages = parentSession.toHistory();
  console.log(`共有 ${parentMessages.length} 条消息:`);
  for (let i = 0; i < parentMessages.length; i++) {
    const m = parentMessages[i];
    const content = typeof m.content === 'string' ? m.content.substring(0, 100) : JSON.stringify(m.content).substring(0, 100);
    console.log(`  [${i}] ${m.role}: ${content}...`);
  }

  // 清理
  console.log("\n【清理资源】");
  const eventMcpManager = env.getEventMcpManager();
  if (eventMcpManager) {
    await eventMcpManager.disconnectAll();
    console.log("✓ EventMcpManager 已断开");
  }
  
  console.log("\n测试完成!");
  process.exit(0);
}

main();
