#!/usr/bin/env bun
/**
 * @fileoverview ServerEnvironment Stream Demo
 * 
 * 演示 ServerEnvironment 的流式事件输出。
 * 一次性输入 query，实时显示流式响应。
 * 
 * Usage:
 *   交互模式: bun run examples/server-env-stream-demo.ts
 *   单次查询: echo "你的问题" | bun run examples/server-env-stream-demo.ts
 */

import { ServerEnvironment } from "../app/server/src/environment.js";
import * as Bus from "../app/server/src/eventbus/bus.js";

// Disable Bus debug logging by overriding console methods
const originalConsoleLog = console.log;
const originalConsoleInfo = console.info;
console.log = (...args: any[]) => {
  // Filter out Bus debug messages
  if (args[0] && typeof args[0] === "string" && args[0].startsWith("[Bus]")) {
    return;
  }
  originalConsoleLog.apply(console, args);
};
console.info = console.log;
import {
  StreamStartEvent,
  StreamTextEvent,
  StreamReasoningEvent,
  StreamToolCallEvent,
  StreamToolResultEvent,
  StreamCompletedEvent,
  StreamErrorEvent,
} from "../app/server/src/eventbus/events/stream.js";
import { Session } from "../src/index.js";

async function loadEnvConfig(path: string): Promise<void> {
  try {
    const text = await Bun.file(path).text();
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          const value = trimmed.substring(eqIndex + 1).trim();
          if (value) process.env[key] = value;
        }
      }
    }
  } catch {}
}

function printHeader(): void {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     ServerEnvironment Stream Demo                          ║");
  console.log("║     流式事件输出测试                                       ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log();
}

async function streamQuery(
  env: ServerEnvironment,
  session: Session,
  query: string
): Promise<void> {
  const sessionId = session.id;
  let isFirstChunk = true;
  const unsubscribers: (() => void)[] = [];

  return new Promise((resolve, reject) => {
    // Subscribe to stream events
    const unsubStart = Bus.subscribe(StreamStartEvent, (event) => {
      if (event.properties.sessionId === sessionId) {
        console.log(`\n🚀 [开始] Model: ${event.properties.model}\n`);
      }
    }, sessionId);
    unsubscribers.push(unsubStart);

    const unsubText = Bus.subscribe(StreamTextEvent, (event) => {
      if (event.properties.sessionId === sessionId) {
        if (isFirstChunk) {
          process.stdout.write("🤖 ");
          isFirstChunk = false;
        }
        process.stdout.write(event.properties.delta);
      }
    }, sessionId);
    unsubscribers.push(unsubText);

    const unsubReasoning = Bus.subscribe(StreamReasoningEvent, (event) => {
      if (event.properties.sessionId === sessionId) {
        console.log(`\n\n💭 [推理] ${event.properties.content.substring(0, 100)}...\n`);
      }
    }, sessionId);
    unsubscribers.push(unsubReasoning);

    const unsubToolCall = Bus.subscribe(StreamToolCallEvent, (event) => {
      if (event.properties.sessionId === sessionId) {
        console.log(`\n\n🔧 [工具调用] ${event.properties.toolName}`);
        console.log(`   参数: ${JSON.stringify(event.properties.toolArgs, null, 2)}\n`);
      }
    }, sessionId);
    unsubscribers.push(unsubToolCall);

    const unsubToolResult = Bus.subscribe(StreamToolResultEvent, (event) => {
      if (event.properties.sessionId === sessionId) {
        const result = typeof event.properties.result === "string" 
          ? event.properties.result.substring(0, 200)
          : JSON.stringify(event.properties.result).substring(0, 200);
        console.log(`\n📋 [工具结果] ${event.properties.toolName}: ${result}...\n`);
      }
    }, sessionId);
    unsubscribers.push(unsubToolResult);

    const unsubCompleted = Bus.subscribe(StreamCompletedEvent, (event) => {
      if (event.properties.sessionId === sessionId) {
        console.log("\n\n✅ [完成]");
        if (event.properties.usage) {
          const { promptTokens, completionTokens, totalTokens } = event.properties.usage;
          console.log(`   Token 使用: ${promptTokens} + ${completionTokens} = ${totalTokens}`);
        }
        console.log();
        
        // Clean up subscriptions
        unsubscribers.forEach(unsub => unsub());
        resolve();
      }
    }, sessionId);
    unsubscribers.push(unsubCompleted);

    const unsubError = Bus.subscribe(StreamErrorEvent, (event) => {
      if (event.properties.sessionId === sessionId) {
        console.error(`\n\n❌ [错误] ${event.properties.error}\n`);
        unsubscribers.forEach(unsub => unsub());
        reject(new Error(event.properties.error));
      }
    }, sessionId);
    unsubscribers.push(unsubError);

    // Execute the query
    const history = session.toHistory();
    env.handle_query(query, { session_id: sessionId }, history)
      .then((response) => {
        // Add messages to session
        session.addUserMessage(query);
        session.addAssistantMessage(response);
      })
      .catch((error) => {
        console.error("Query error:", error);
        unsubscribers.forEach(unsub => unsub());
        reject(error);
      });
  });
}

async function readLine(): Promise<string> {
  if (process.stdin.isTTY) {
    const rl = await import("node:readline");
    return new Promise((resolve) => {
      const iface = rl.createInterface({ 
        input: process.stdin, 
        output: process.stdout, 
        terminal: true 
      });
      iface.question("💬 输入问题: ", (ans) => {
        iface.close();
        resolve(ans.trim());
      });
    });
  } else {
    const text = await new Response(Bun.stdin).text();
    return text.trim();
  }
}

async function main(): Promise<void> {
  await loadEnvConfig(".env");

  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL;

  if (!model || !apiKey) {
    console.log("❌ 请在 .env 中配置 LLM_MODEL 和 LLM_API_KEY");
    console.log();
    console.log("示例 .env:");
    console.log("  LLM_MODEL=openai/gpt-4o-mini");
    console.log("  LLM_API_KEY=your-api-key");
    console.log("  LLM_BASE_URL=https://api.openai.com/v1  # 可选");
    process.exit(1);
  }

  printHeader();

  // Create ServerEnvironment with EventBus integration
  console.log("🔄 初始化 ServerEnvironment...");
  const env = new ServerEnvironment({
    model,
    apiKey,
    baseURL,
    sessionId: "demo-session",
  });
  console.log(`✅ Environment 已创建`);
  console.log(`   Model: ${model}`);
  console.log(`   Tools: ${env.listTools().map(t => t.name).join(", ")}`);
  console.log();

  // Create session
  const session = Session.create({ 
    title: "Stream Demo", 
    directory: process.cwd() 
  });
  console.log(`📁 Session: ${session.id}`);
  console.log();

  // Interactive or single query mode
  if (process.stdin.isTTY) {
    console.log("交互模式 - 输入你的问题 (输入 'quit' 退出):\n");
    
    while (true) {
      const query = await readLine();
      
      if (!query) continue;
      if (query.toLowerCase() === "quit" || query.toLowerCase() === "exit") {
        console.log("\n👋 再见!");
        break;
      }

      try {
        await streamQuery(env, session, query);
      } catch (error) {
        console.error("\n错误:", error);
      }
      
      console.log("─".repeat(60));
      console.log();
    }
  } else {
    // Single query mode (piped input)
    const query = await readLine();
    if (!query) {
      console.log("❌ 请输入问题");
      process.exit(1);
    }

    console.log(`💬 问题: ${query}\n`);
    
    try {
      await streamQuery(env, session, query);
    } catch (error) {
      console.error("\n错误:", error);
      process.exit(1);
    }
  }
}

main().catch(console.error);
