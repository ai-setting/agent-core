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

  // 创建并发布 timer event（不走手动注册的 rule，直接触发默认的 timer.* function rule）
  const timerEvent: EnvEvent = {
    id: `timer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "timer.heartbeat",
    timestamp: Date.now(),
    metadata: {
      trigger_session_id: session.id,
      source: "test-timer",
      clientId: clientId,
    },
    payload: {
      count: 1,
      message: "Test timer event from test-event-trigger.ts"
    }
  };

  console.log("【发布 Timer Event】");
  console.log(`  Event ID: ${timerEvent.id}`);
  console.log(`  Event Type: ${timerEvent.type}`);
  console.log(`  Trigger Session: ${timerEvent.metadata.trigger_session_id}`);
  console.log("");

  try {
    console.log("【Event Handler Agent 处理中...】\n");
    
    // 发布事件，触发 event handler agent
    await env.publishEvent(timerEvent);
    
    console.log("\n✓ Event 已发布并处理完成");
    console.log("\n【验证结果】");
    console.log(`  Session 消息数: ${(session as any)._messageOrder?.length}`);
    
    // 查看最后几条消息
    const history = session.toHistory();
    console.log(`  toHistory() 返回消息数: ${history.length}`);
    
    if (history.length > 0) {
      console.log("\n【最后 3 条消息】");
      const recentMessages = history.slice(-3);
      recentMessages.forEach((msg: any, idx: number) => {
        const content = typeof msg.content === 'string' 
          ? msg.content.substring(0, 100) 
          : JSON.stringify(msg.content).substring(0, 100);
        console.log(`  [${history.length - 3 + idx + 1}] role=${msg.role}: ${content}...`);
      });
    }
    
  } catch (error: any) {
    console.error("\n【Error】");
    console.error(`错误信息: ${error.message}`);
    console.error(error.stack);
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
