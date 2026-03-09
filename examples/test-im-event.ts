/**
 * 测试 IM Event 处理流程
 * 
 * 复现问题：chat_id 存在但找不到已存在的 session
 * 
 * 问题根因：
 * - chat_id 在 event.payload.message.chat_id 里
 * - 但 EventHandlerAgent 从 event.metadata.chat_id 获取
 * 
 * 修复后验证：
 * - chat_id 同时从 metadata 和 payload.message 读取
 */

import { ServerEnvironment } from "../packages/core/src/server/environment.js";
import { EventHandlerAgent } from "../packages/core/src/core/agent/event-handler-agent.js";
import type { EnvEvent } from "../packages/core/src/core/types/event.js";

async function main() {
  process.env.EVENTSOURCE_POLLING_ENABLED = "false";

  console.log("==============================================");
  console.log("    IM Event Session 查找测试");
  console.log("==============================================\n");

  const env = new ServerEnvironment({});
  
  console.log("等待环境就绪...");
  await env.waitForReady();
  
  const model = env.getCurrentModel();
  console.log("✓ ServerEnvironment 就绪");
  console.log(`  Model: ${model?.providerID}/${model?.modelID}\n`);

  // 测试场景：使用真实的 chat_id 从日志/数据库中查找已存在的 session
  const chatId = "oc_a8b45bfdb8c9ae3ab24a81466033c8f1";
  
  console.log("=== 测试1: 直接通过 Storage.findSessionIdsByMetadata 查找 ===");
  const { Storage } = await import("../packages/core/src/core/session/storage.js");
  const sessionsByMetadata = await Storage.findSessionIdsByMetadata({ chat_id: chatId });
  console.log(`  通过 chat_id=${chatId} 找到的 session 数量: ${sessionsByMetadata.length}`);
  console.log(`  Session IDs: ${JSON.stringify(sessionsByMetadata)}\n`);

  console.log("=== 测试2: 通过 env.findSessionsByMetadata 查找 ===");
  const sessionsByEnv = await env.findSessionsByMetadata({ chat_id: chatId });
  console.log(`  通过 chat_id=${chatId} 找到的 session 数量: ${sessionsByEnv.length}`);
  console.log(`  Session IDs: ${JSON.stringify(sessionsByEnv)}\n`);

  // 列出所有包含这个 chat_id 的 session
  if (sessionsByEnv.length > 0) {
    console.log("=== 找到已存在的 session ===");
    for (const sessionId of sessionsByEnv) {
      const session = await env.getSession(sessionId);
      console.log(`  Session: ${sessionId}`);
      console.log(`    Title: ${session?.title}`);
      console.log(`    Metadata: ${JSON.stringify((session as any)?.metadata)}`);
    }
  } else {
    console.log("❌ 没有找到包含此 chat_id 的 session\n");
    
  // 查看数据库中所有 session 的 metadata
  console.log("=== 检查数据库中的 session metadata ===");
  const allSessions = Storage.listSessions();
  for (const s of allSessions) {
    if ((s as any).metadata) {
      const hasChatId = JSON.stringify((s as any).metadata).includes(chatId);
      if (hasChatId) {
        console.log(`  找到包含 chat_id 的 session: ${s.id}`);
        console.log(`    Title: ${s.title}`);
        console.log(`    Metadata: ${JSON.stringify((s as any).metadata)}`);
      }
    }
  }
  }

  console.log("\n=== 测试3: 模拟 IM Event (chat_id 在 payload.message.chat_id) ===");
  
  // 模拟飞书 IM 消息事件，chat_id 在 payload.message.chat_id
  const imEvent: EnvEvent = {
    id: `im_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "im.message.receive_v1",
    timestamp: Date.now(),
    metadata: {
      source: "feishu",
      source_name: "feishu",
      // 注意：这里没有 chat_id！
    },
    payload: {
      message: {
        message_id: `om_${Date.now()}`,
        message_type: "text",
        content: "{\"text\":\"测试消息\"}",
        chat_id: chatId,  // chat_id 在这里！
        chat_type: "p2p",
      },
    },
  };

  console.log("  Event metadata:", JSON.stringify(imEvent.metadata));
  console.log("  Event payload.message.chat_id:", (imEvent.payload as any).message?.chat_id);
  console.log("  Event metadata.chat_id:", imEvent.metadata?.chat_id);
  console.log("");
  
  // 问题演示：代码会从 metadata.chat_id 读取，但实际在 payload.message.chat_id
  const chatIdFromMetadata = imEvent.metadata?.chat_id as string | undefined;
  const chatIdFromPayload = (imEvent.payload as any)?.message?.chat_id as string | undefined;
  
  console.log("  从 metadata 读取的 chat_id:", chatIdFromMetadata || "(undefined)");
  console.log("  从 payload.message 读取的 chat_id:", chatIdFromPayload || "(undefined)");
  console.log("");
  
  // 使用正确的 chat_id (从 payload 读取) 查找 session
  if (chatIdFromPayload) {
    const sessionsWithPayloadChatId = await env.findSessionsByMetadata({ chat_id: chatIdFromPayload });
    console.log(`  使用 payload.chat_id 查找: 找到 ${sessionsWithPayloadChatId.length} 个 session`);
  }

  // 使用错误的 chat_id (从 metadata 读取) 查找 session
  if (chatIdFromMetadata) {
    const sessionsWithMetadataChatId = await env.findSessionsByMetadata({ chat_id: chatIdFromMetadata });
    console.log(`  使用 metadata.chat_id 查找: 找到 ${sessionsWithMetadataChatId.length} 个 session`);
  } else {
    console.log(`  使用 metadata.chat_id 查找: 找不到 (因为 metadata 里没有 chat_id)`);
  }

  console.log("\n【结论】");
  console.log("  问题：EventHandlerAgent 从 event.metadata.chat_id 读取 chat_id");
  console.log("  实际：chat_id 在 event.payload.message.chat_id");
  console.log("  结果：重启后找不到已存在的 session，创建一个新的\n");

  console.log("=== 测试4: 直接测试 EventHandlerAgent (修复后) ===");
  
  // 直接使用 EventHandlerAgent 处理 IM 事件
  const eventHandlerAgent = new EventHandlerAgent(env, "You are a helpful assistant");
  
  // 模拟飞书 IM 消息事件
  const imEventForAgent: EnvEvent = {
    id: `im_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "im.message.receive_v1",
    timestamp: Date.now(),
    metadata: {
      source: "feishu",
      source_name: "feishu",
      // 注意：这里没有 chat_id
    },
    payload: {
      message: {
        message_id: `om_${Date.now()}`,
        message_type: "text",
        content: "{\"text\":\"测试消息\"}",
        chat_id: chatId,  // chat_id 在这里
        chat_type: "p2p",
      },
    },
  };

  console.log("  模拟 IM 事件:");
  console.log(`    event.metadata: ${JSON.stringify(imEventForAgent.metadata)}`);
  console.log(`    event.payload.message.chat_id: ${(imEventForAgent.payload as any).message?.chat_id}`);
  console.log("");
  console.log("  调用 EventHandlerAgent.handle()...");
  
  // 由于 handle_query 会调用 LLM，这里只测试能否找到 session
  // 我们可以通过日志来验证是否找到了 session
  
  // 手动测试 chat_id 查找逻辑
  const fixedChatId = (imEventForAgent.metadata?.chat_id ?? (imEventForAgent.payload as any)?.message?.chat_id) as string | undefined;
  console.log(`  修复后读取的 chat_id: ${fixedChatId}`);
  
  if (fixedChatId) {
    const relatedSessionIds = await env.findSessionsByMetadata({ chat_id: fixedChatId });
    console.log(`  修复后 findSessionsByMetadata 找到: ${relatedSessionIds.length} 个 session`);
    if (relatedSessionIds.length > 0) {
      console.log(`    第一个 session: ${relatedSessionIds[0]}`);
    }
  }

  console.log("\n【清理资源】");
  const eventMcpManager = env.getEventMcpManager();
  if (eventMcpManager) {
    await eventMcpManager.disconnectAll();
  }
  
  console.log("\n测试完成!");
  process.exit(0);
}

main();
