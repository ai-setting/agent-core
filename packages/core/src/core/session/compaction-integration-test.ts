/**
 * @fileoverview Compaction Integration Test
 * 
 * 测试自动压缩功能：
 * 1. 创建一个有很多消息的 session
 * 2. 通过 invokeLLM 触发压缩
 * 3. 验证压缩产生的 summary 和 new session
 * 
 * 运行方式: bun run packages/core/src/core/session/compaction-integration-test.ts
 */

import { Session } from "./session.js";
import { Storage } from "./storage.js";
import { modelLimitsManager } from "./model-limits.js";

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("=== Compaction Integration Test ===\n");

  // Initialize storage
  await Storage.initialize({ mode: "memory" });

  // Create a session with many messages (simulating long conversation)
  const sessionId = "test-compaction-session";
  const session = new Session({
    id: sessionId,
    title: "Long Conversation Session",
  });

  // Add many messages to simulate long conversation
  console.log("Adding messages to session...");
  for (let i = 0; i < 30; i++) {
    session.addUserMessage(`User message ${i + 1}: I need help with task ${i + 1}`);
    session.addAssistantMessage(`Assistant response ${i + 1}: Here's the solution for task ${i + 1}. This is a detailed response that includes implementation steps and code examples.`);
  }

  console.log(`Session created with ${session.getMessages().length} messages`);

  // Get current context stats before compaction
  const statsBefore = session.getContextStats();
  console.log("\nContext stats BEFORE compaction:");
  console.log(`  - Request count: ${statsBefore?.requestCount ?? 0}`);
  console.log(`  - Usage percent: ${statsBefore?.usagePercent ?? 0}%`);

  // Mock an environment with invokeLLM to trigger compaction
  // We'll simulate high token usage to trigger compaction
  console.log("\nSimulating high token usage to trigger compaction...");

  // Manually trigger updateContextUsage with high tokens and env
  // This simulates what happens when invokeLLM is called with large context
  const mockEnv = {
    invokeLLM: async () => ({
      success: true,
      output: "Summary of the conversation",
    }),
  } as any;

  // Update with high usage (85% - above 80% threshold)
  // This should trigger compaction
  await session.updateContextUsage(
    {
      inputTokens: 60000,
      outputTokens: 25000,
      totalTokens: 85000,
    },
    100000, // context window limit
    mockEnv, // env to trigger compaction
    "gpt-4o" // model ID
  );

  // Wait for async compaction to complete
  await sleep(100);

  // Get context stats after compaction
  const statsAfter = session.getContextStats();
  console.log("\nContext stats AFTER compaction:");
  console.log(`  - Request count: ${statsAfter?.requestCount ?? 0}`);
  console.log(`  - Usage percent: ${statsAfter?.usagePercent ?? 0}%`);
  console.log(`  - Compacted: ${statsAfter?.compacted ?? false}`);
  console.log(`  - Compacted session ID: ${statsAfter?.compactedSessionId ?? "none"}`);

  // Check if compaction was triggered
  if (statsAfter?.compacted && statsAfter?.compactedSessionId) {
    console.log("\n✅ Compaction triggered successfully!");

    // Get the compacted session
    const compactedSession = Session.get(statsAfter.compactedSessionId);
    if (compactedSession) {
      console.log("\n--- Compacted Session ---");
      console.log(`ID: ${compactedSession.id}`);
      console.log(`Parent ID: ${compactedSession.parentID}`);
      console.log(`Title: ${compactedSession.title}`);
      
      const messages = compactedSession.getMessages();
      console.log(`Message count: ${messages.length}`);
      
      if (messages.length > 0) {
        console.log("\n--- First Message (Summary) ---");
        console.log(messages[0].parts.map(p => 
          p.type === "text" ? (p as any).text : ""
        ).join(""));
      }
    }

    console.log("\n=== TEST PASSED ===");
  } else {
    console.log("\n❌ Compaction was NOT triggered");
    console.log("\n=== TEST FAILED ===");
    process.exit(1);
  }

  // Clean up
  Storage.clear();
}

main().catch(console.error);
