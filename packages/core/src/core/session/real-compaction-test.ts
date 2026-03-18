/**
 * 手动触发压缩测试 - 使用正确的 contextWindow
 * 运行: bun run src/core/session/manual-compaction-test.ts
 */

import { Session } from "./session.js";
import { Storage } from "./storage.js";

async function main() {
  // Initialize with file storage to persist
  await Storage.initialize({ mode: "sqlite", path: "/home/dzk/.local/share/tong_work/agent-core/storage/sessions.db" });

  const sessionId = "test-compaction-real";

  // Delete if exists
  const existing = Session.get(sessionId);
  if (existing) {
    Storage.deleteSession(sessionId);
  }

  // Create new session
  const session = new Session({
    id: sessionId,
    title: "Real Compaction Test",
  });

  // Add many messages
  const longContent = "这是一个很长的对话内容 ".repeat(100);
  for (let i = 0; i < 30; i++) {
    session.addUserMessage(`用户问题 ${i}: ${longContent}`);
    session.addAssistantMessage(`助手回答 ${i}: ${longContent}`);
  }

  console.log("=== Session 创建完成 ===");
  console.log("Messages:", session.getMessages().length);

  // Mock env
  const mockEnv = {
    invokeLLM: async () => {
      return {
        success: true,
        output: JSON.stringify({
          user_intent: "测试压缩功能",
          key_decisions: ["测试"],
          current_status: "测试中",
          next_steps: ["验证"],
          important_context: ["测试内容"]
        })
      };
    }
  } as any;

  // Use 200000 context window (from config)
  const contextWindow = 200000;
  const threshold = 0.8;
  const triggerTokens = Math.floor(contextWindow * threshold) + 1; // 160001

  console.log(`\n=== 模拟高 token 使用量 ===`);
  console.log(`Context Window: ${contextWindow}`);
  console.log(`Threshold: ${threshold * 100}%`);
  console.log(`Trigger Tokens: ${triggerTokens}`);

  await session.updateContextUsage(
    {
      inputTokens: triggerTokens - 1000,
      outputTokens: 1000,
      totalTokens: triggerTokens,
    },
    contextWindow,
    mockEnv,
    "MiniMax-M2.5"
  );

  await new Promise(r => setTimeout(r, 100));

  const stats = session.getContextStats();
  console.log("\n=== 结果 ===");
  console.log("usagePercent:", stats?.usagePercent);
  console.log("compacted:", stats?.compacted);
  console.log("compactedSessionId:", stats?.compactedSessionId);

  if (stats?.compactedSessionId) {
    const cs = Session.get(stats.compactedSessionId);
    if (cs) {
      const msg = cs.getMessages()[0];
      if (msg?.parts[0]?.type === "text") {
        console.log("\n=== 摘要 ===");
        try {
          console.log(JSON.stringify(JSON.parse((msg.parts[0] as any).text), null, 2));
        } catch {
          console.log((msg.parts[0] as any).text);
        }
      }
    }
  }
}

main().catch(console.error);
