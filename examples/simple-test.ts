/**
 * 复现 tool id not found 问题
 * 
 * 模拟 fetch prompt 路由进入之后的逻辑
 */

import { ServerEnvironment } from "../packages/core/src/server/environment.js";
import { getTraceContext } from "../packages/core/src/utils/trace-context.js";

async function main() {
  process.env.EVENTSOURCE_POLLING_ENABLED = "false";

  console.log("==============================================");
  console.log("    Tool ID Not Found 问题复现测试");
  console.log("==============================================\n");

  const env = new ServerEnvironment({});
  
  console.log("等待环境就绪...");
  await env.waitForReady();
  
  const model = env.getCurrentModel();
  console.log("✓ ServerEnvironment 就绪");
  console.log(`  Model: ${model?.providerID}/${model?.modelID}\n`);

  // 加载指定的 session
  const sessionId = "ses_343d8c80dffeYCREPJUxrDNMKp";
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

  // 模拟 fetch prompt 路由之后的逻辑
  const query = "将具体的assistant消息展示给我看吧";
  
  // Step 1: toHistory() 获取历史消息
  const history = session.toHistory();
  console.log("【Step 1】toHistory()");
  console.log(`  返回消息数: ${history.length}`);
  if (history.length > 0) {
    console.log(`  最后5条消息 role: ${history.slice(-5).map((m: any) => m.role).join(", ")}`);
    
    // Check for tool call ids
    for (let i = 0; i < Math.min(history.length, 10); i++) {
      const msg = history[i];
      if (msg.role === "tool") {
        console.log(`  message[${i}] tool: ${JSON.stringify(msg.content).substring(0, 100)}`);
      } else if (msg.role === "assistant") {
        const content = msg.content as any;
        const hasTool = content?.some((p: any) => p.type === "tool-call");
        if (hasTool) {
          console.log(`  message[${i}] assistant with tool-call`);
        }
      }
    }
  }
  console.log("");

  // Step 2: addUserMessage
  session.addUserMessage(query);
  console.log("【Step 2】addUserMessage()");
  console.log(`  已添加用户消息\n`);

  // Step 3: handle_query
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  getTraceContext().initContext(requestId, session.id);
  console.log("【Step 3】handle_query()");
  console.log(`  requestId: ${requestId}`);
  
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
    console.error("\n【Error】");
    console.error(error);
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
