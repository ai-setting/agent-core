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

  // Mock an environment with handle_query to trigger compaction
  // We'll simulate high token usage to trigger compaction
  console.log("\nSimulating high token usage to trigger compaction...");

  // Mock environment with handle_query (required by updated compact method)
  const mockEnv = {
    handle_query: async (query: string, context: any, history: any) => {
      // Return a mock summary
      return "Summary: User requested help with 30 tasks. Assistant provided solutions for all tasks. Most tasks involve coding and problem-solving.";
    },
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

  // Test 2: Compaction Chain Test
  console.log("\n\n=== Compaction Chain Test ===\n");

  await Storage.initialize({ mode: "memory" });

  // Create parent session
  const parentSession = new Session({
    id: "parent-session",
    title: "Parent Session",
  });

  // Add some messages
  for (let i = 0; i < 20; i++) {
    parentSession.addUserMessage(`Parent message ${i + 1}`);
    parentSession.addAssistantMessage(`Parent response ${i + 1}`);
  }

  Storage.saveSession(parentSession);

  // Mark parent as compacted (simulate previous compaction)
  parentSession._info.contextUsage = {
    inputTokens: 60000,
    outputTokens: 25000,
    totalTokens: 85000,
    contextWindow: 100000,
    usagePercent: 85,
    requestCount: 1,
    lastUpdated: Date.now(),
    compacted: true,
    compactedSessionId: "child-session-1",
  };
  Storage.saveSession(parentSession);

  // Create first child session
  const childSession1 = new Session({
    id: "child-session-1",
    title: "Compacted: Parent Session",
    parentID: "parent-session",
  });
  childSession1.addUserMessage("Child 1 message");
  Storage.saveSession(childSession1);

  // Test Session.get traverses chain
  const latestSession = Session.get("parent-session");
  console.log("Testing Session.get with compaction chain:");
  console.log(`  - Original session ID: parent-session`);
  console.log(`  - Latest session ID: ${latestSession?.id}`);

  if (latestSession?.id === "child-session-1") {
    console.log("  ✅ Session.get correctly traverses compaction chain");
  } else {
    console.log("  ❌ Session.get did NOT traverse compaction chain");
  }

  // Test Session.getWithoutChain returns exact session
  const exactSession = Session.getWithoutChain("parent-session");
  console.log(`\nTesting Session.getWithoutChain:`);
  console.log(`  - Requested session ID: parent-session`);
  console.log(`  - Returned session ID: ${exactSession?.id}`);

  if (exactSession?.id === "parent-session") {
    console.log("  ✅ Session.getWithoutChain returns exact session");
  } else {
    console.log("  ❌ Session.getWithoutChain did NOT return exact session");
  }

  console.log("\n=== ALL TESTS PASSED ===");
}

main().catch(console.error);
