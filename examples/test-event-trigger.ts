/**
 * 测试 Event Handler Agent 流程
 * 
 * 复用 test-context-window.ts 中的 session_id (ses_3422089a5ffefKehCES1GcGBg5)
 * 模拟 timer event 触发 event handler agent 处理
 * 
 * Event Handler Agent 流程：
 * 1. EnvEventBus.publish() 接收 EnvEvent
 * 2. 匹配到对应的 EnvEventRule (handler type = "agent")
 * 3. 创建 EventHandlerAgent 并调用 handle()
 * 4. handle() 从 event.metadata.trigger_session_id 获取 sessionId
 * 5. 构造 3 条消息 (user, assistant with tool call, tool result)
 * 6. 调用 env.handle_query() 处理事件
 */

import { ServerEnvironment } from "../packages/core/src/server/environment.js";
import { EnvEventBus, type EnvAgentHandler } from "../packages/core/src/server/eventbus/bus.js";
import type { EnvEvent } from "../packages/core/src/core/types/event.js";

async function main() {
  process.env.EVENTSOURCE_POLLING_ENABLED = "false";

  console.log("==============================================");
  console.log("    Event Handler Agent 触发测试");
  console.log("==============================================\n");

  const env = new ServerEnvironment({});
  
  console.log("等待环境就绪...");
  await env.waitForReady();
  
  const model = env.getCurrentModel();
  console.log("✓ ServerEnvironment 就绪");
  console.log(`  Model: ${model?.providerID}/${model?.modelID}\n`);

  const sessionId = "ses_3422089a5ffefKehCES1GcGBg5";
  const session = await env.getSession(sessionId);
  
  if (!session) {
    console.error("❌ Session 不存在:", sessionId);
    console.log("\n请先运行 test-context-window.ts 创建 session，或使用一个存在的 session ID");
    process.exit(1);
  }

  const { Storage } = await import("../packages/core/src/core/session/storage.js");
  await Storage.loadSessionMessages(session.id);
  
  console.log("✓ Session 已加载:", session.id);
  console.log(`  Title: ${session.title}`);
  console.log(`  _messageOrder.length: ${(session as any)._messageOrder?.length}`);
  console.log("");

  // 设置 active session（让 event handler agent 在没有 trigger_session_id 时可以 fallback 到这个 session）
  const clientId = "test-client-id";
  env.getActiveSessionManager().setActiveSession(clientId, session.id);
  console.log(`✓ Active session 设置: clientId=${clientId}, sessionId=${session.id}`);
  console.log("");

  // 获取 eventBus 并注册 timer 事件的处理规则
  const eventBus = (env as any).eventBus as EnvEventBus;

  // 测试场景1: 有 trigger_session_id，handle_query 会报错，验证 new session 重试
  console.log("=== 测试场景1: handle_query 报错，验证 new session 重试 ===");

  const timerEvent1: EnvEvent = {
    id: `timer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "timer.heartbeat",
    timestamp: Date.now(),
    metadata: {
      trigger_session_id: session.id,
      source: "test-timer",
    },
    payload: {
      count: 1,
      message: "Test timer event to trigger retry logic"
    }
  };

  console.log("【发布 Timer Event】");
  console.log(`  Event ID: ${timerEvent1.id}`);
  console.log(`  Event Type: ${timerEvent1.type}`);
  console.log(`  Trigger Session: ${timerEvent1.metadata.trigger_session_id}`);
  console.log("  预期: handle_query 报错后创建 new session 重试\n");

  try {
    await env.publishEvent(timerEvent1);
    console.log("✓ Event 处理完成（应创建 new session 并重试成功）\n");
  } catch (error: any) {
    console.error("【Error】", error.message);
  }

  // 测试场景2: 没有 trigger_session_id，也没有 clientId，创建 new session
  console.log("=== 测试场景2: 没有 trigger_session_id，也没有 clientId (创建 new session) ===");
  const timerEvent2: EnvEvent = {
    id: `timer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "timer.heartbeat",
    timestamp: Date.now(),
    metadata: {
      source: "test-timer",
    },
    payload: {
      count: 2,
      message: "Test timer event to trigger new session creation"
    }
  };

  console.log("【发布 Timer Event】");
  console.log(`  Event ID: ${timerEvent2.id}`);
  console.log(`  Event Type: ${timerEvent2.type}`);
  console.log(`  metadata: ${JSON.stringify(timerEvent2.metadata)}`);
  console.log("");

  try {
    await env.publishEvent(timerEvent2);
    console.log("✓ Event 处理完成（应创建 new session）\n");
  } catch (error: any) {
    console.error("【Error】", error.message);
  }

  // 清理
  console.log("【清理资源】");
  const eventMcpManager = env.getEventMcpManager();
  if (eventMcpManager) {
    await eventMcpManager.disconnectAll();
  }
  
  console.log("\n测试完成!");
  process.exit(0);
}

main();
