/**
 * 手动触发压缩测试
 * 运行: bun run src/core/session/manual-compaction-test.ts
 */

import { Session } from "./session.js";
import { Storage } from "./storage.js";

async function main() {
  // Initialize with file storage to persist
  await Storage.initialize({ mode: "sqlite", path: "/home/dzk/.local/share/tong_work/agent-core/storage/sessions.db" });

  const sessionId = "test-compaction-session";

  // Get session
  const session = Session.get(sessionId);
  if (!session) {
    console.error("Session not found:", sessionId);
    return;
  }

  console.log("=== 测试手动压缩 ===");
  console.log("Session ID:", session.id);
  console.log("Messages:", session.getMessages().length);
  
  const stats = session.getContextStats();
  console.log("Context Usage:", stats);

  // Mock env that simulates invokeLLM being called
  const mockEnv = {
    invokeLLM: async () => {
      console.log("Mock invokeLLM called");
      return {
        success: true,
        output: JSON.stringify({
          user_intent: "学习 TypeScript",
          key_decisions: ["使用泛型", "使用 Result 类型处理错误"],
          current_status: "已完成学习",
          next_steps: ["实践项目"],
          important_context: ["泛型是核心特性"]
        })
      };
    }
  } as any;

  // Manually update context usage to simulate LLM call with high token count
  // This simulates what happens after invokeLLM returns
  console.log("\n=== 模拟高 token 使用量 ===");
  
  // High token count that exceeds 80% threshold
  await session.updateContextUsage(
    {
      inputTokens: 85000,  // High input tokens
      outputTokens: 15000, // Some output tokens
      totalTokens: 100000,  // 100K total
    },
    100000, // Context window
    mockEnv, // Pass env to trigger compaction
    "gpt-4o" // Model ID
  );

  // Wait a bit for async compaction
  await new Promise(r => setTimeout(r, 100));

  // Check result
  const newStats = session.getContextStats();
  console.log("\n=== 压缩后状态 ===");
  console.log("Compacted:", newStats?.compacted);
  console.log("Compacted Session ID:", newStats?.compactedSessionId);

  if (newStats?.compactedSessionId) {
    const compactedSession = Session.get(newStats.compactedSessionId);
    if (compactedSession) {
      console.log("\n=== 压缩后的 Session ===");
      console.log("ID:", compactedSession.id);
      console.log("Parent:", compactedSession.parentID);
      console.log("Messages:", compactedSession.getMessages().length);
      
      const msg = compactedSession.getMessages()[0];
      if (msg?.parts[0]?.type === "text") {
        console.log("\n=== 摘要内容 ===");
        try {
          const summary = JSON.parse((msg.parts[0] as any).text);
          console.log(JSON.stringify(summary, null, 2));
        } catch {
          console.log((msg.parts[0] as any).text);
        }
      }
    }
  }
}

main().catch(console.error);
