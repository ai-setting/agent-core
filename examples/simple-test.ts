/**
 * 复现后台任务错误问题
 */

import { ServerEnvironment } from "../packages/core/src/server/environment.js";

async function main() {
  process.env.EVENTSOURCE_POLLING_ENABLED = "false";

  console.log("==============================================");
  console.log("    后台任务错误复现测试");
  console.log("==============================================\n");

  const env = new ServerEnvironment({});
  await env.waitForReady();
  
  const model = env.getCurrentModel();
  console.log("✓ ServerEnvironment 就绪");
  console.log(`  Model: ${model?.providerID}/${model?.modelID}\n`);

  // 创建父 Session
  const parentSession = env.createSession({ title: "Test Parent Session" });
  console.log("✓ 父 Session 已创建:", parentSession.id, "\n");

  // 测试通过主 Agent 调用 task tool（后台任务）
  console.log("【测试后台任务】");
  console.log("Prompt: 启动后台任务帮我检索github trend最热门项目\n");
  
  await env.handle_query("启动后台任务帮我检索github trend最热门项目", {
    session_id: parentSession.id,
    onMessageAdded: (message) => {
      console.log(`[onMessageAdded] role=${message.role}, content=${JSON.stringify(message.content).substring(0, 150)}...`);
      parentSession.addMessageFromModelMessage(message);
    }
  });

  // 等待后台任务完成
  await new Promise(r => setTimeout(r, 5000));

  // 检查父 session 的消息
  console.log("\n【父 Session 消息列表】");
  const parentMessages = parentSession.toHistory();
  console.log(`共有 ${parentMessages.length} 条消息:`);
  for (let i = 0; i < parentMessages.length; i++) {
    const m = parentMessages[i];
    const content = typeof m.content === 'string' ? m.content.substring(0, 150) : JSON.stringify(m.content).substring(0, 150);
    console.log(`  [${i}] ${m.role}: ${content}...`);
  }

  // 清理
  console.log("\n【清理资源】");
  const eventMcpManager = env.getEventMcpManager();
  if (eventMcpManager) {
    await eventMcpManager.disconnectAll();
  }
  
  console.log("\n测试完成!");
  process.exit(0);
}

main();
