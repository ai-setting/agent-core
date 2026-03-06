/**
 * 复现 context window exceeds limit 问题
 * 
 * 使用日志中有问题的 session (ses_3422089a5ffefKehCES1GcGBg5) 来复现
 * 日志显示 messageCount 达到 697-709 时会触发 "context window exceeds limit"
 */

import { ServerEnvironment } from "../packages/core/src/server/environment.js";
import { getTraceContext } from "../packages/core/src/utils/trace-context.js";

async function main() {
  process.env.EVENTSOURCE_POLLING_ENABLED = "false";

  console.log("==============================================");
  console.log("    Context Window 超过限制 复现测试");
  console.log("==============================================\n");

  const env = new ServerEnvironment({});
  
  console.log("等待环境就绪...");
  await env.waitForReady();
  
  const model = env.getCurrentModel();
  console.log("✓ ServerEnvironment 就绪");
  console.log(`  Model: ${model?.providerID}/${model?.modelID}\n`);

  // 加载日志中有问题的 session
  const sessionId = "ses_3422089a5ffefKehCES1GcGBg5";
  const session = await env.getSession(sessionId);
  
  if (!session) {
    console.error("❌ Session 不存在:", sessionId);
    process.exit(1);
  }

  // Load messages for this session on demand (like TUI does)
  const { Storage } = await import("../packages/core/src/core/session/storage.js");
  await Storage.loadSessionMessages(session.id);
  
  console.log("✓ Session 已加载:", session.id);
  console.log(`  Title: ${session.title}`);
  console.log(`  _messageOrder.length: ${(session as any)._messageOrder?.length}`);
  console.log(`  _messages.size: ${(session as any)._messages?.size}`);
  console.log("");

  // 获取历史消息
  const history = session.toHistory();
  console.log("【Session 状态】");
  console.log(`  toHistory() 返回消息数: ${history.length}`);
  console.log("");

  // 发送新消息，触发上下文窗口超限
  const query = "你好";
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  getTraceContext().initContext(requestId, session.id);
  
  console.log("【发送消息】尝试触发上下文窗口超限...");
  console.log(`  requestId: ${requestId}`);
  console.log(`  当前消息数: ${history.length}`);
  console.log("");

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
  } catch (error: any) {
    console.error("\n【Error】");
    console.error(`错误信息: ${error.message}`);
    console.error("");
    console.log("✓ 成功复现 context window exceeds limit 问题！");
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
