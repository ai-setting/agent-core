/**
 * @fileoverview Compaction Demo - 展示真实压缩效果
 * 
 * 运行方式: cd packages/core && bun run src/core/session/compaction-demo.ts
 */

import { Session } from "./session.js";
import { Storage } from "./storage.js";

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("=== Compaction Demo - 真实压缩效果 ===\n");

  // Initialize storage
  await Storage.initialize({ mode: "memory" });

  // Create a session with realistic messages
  const sessionId = "demo-session";
  const session = new Session({
    id: sessionId,
    title: "Demo Conversation",
  });

  // Add realistic conversation messages
  console.log("添加对话消息...");
  const messages = [
    { role: "user", content: "我想学习 TypeScript，能帮我推荐一些学习资源吗？" },
    { role: "assistant", content: "当然可以！以下是一些优秀的 TypeScript 学习资源：\n\n1. 官方文档：typescriptlang.org/docs\n2. 《Programming TypeScript》书籍\n3. TypeScript Deep Dive 在线书籍\n4. Udemy 课程\n\n建议从官方文档开始，它是最好的入门资源。" },
    { role: "user", content: "谢谢！那能帮我解释一下泛型吗？" },
    { role: "assistant", content: "泛型（Generics）是 TypeScript 最强大的特性之一。\n\n简单来说，泛型允许你创建可复用的组件，能够支持多种类型而不是单一类型。\n\n```typescript\nfunction identity<T>(arg: T): T {\n  return arg;\n}\n\nlet result = identity<string>(\"hello\"); // type: string\nlet result2 = identity(123); // type: number (类型推断)\n```\n\n泛型让你可以创建：\n- 泛型接口\n- 泛型类\n- 泛型函数\n- 泛型约束" },
    { role: "user", content: "能给我一个实际项目中使用泛型的例子吗？" },
    { role: "assistant", content: "当然！以下是一个实际项目中的例子：\n\n```typescript\n// API 响应类型\ninterface ApiResponse<T> {\n  data: T;\n  status: number;\n  message: string;\n}\n\n// 用户类型\ninterface User {\n  id: number;\n  name: string;\n  email: string;\n}\n\n// 使用泛型\nasync function fetchUser(id: number): Promise<ApiResponse<User>> {\n  const response = await fetch(`/api/users/${id}`);\n  return response.json();\n}\n\n// 调用\nconst result = await fetchUser(1);\n// result.data 是 User 类型\nconsole.log(result.data.name);\n```\n\n这样我们可以用同一个 ApiResponse 接口处理不同类型的数据！" },
    { role: "user", content: "很好！再问一下，如何处理 API 错误？" },
    { role: "assistant", content: "处理 API 错误有几种常用方式：\n\n1. **try-catch**\n```typescript\ntry {\n  const result = await fetchUser(1);\n} catch (error) {\n  console.error('请求失败:', error);\n}\n```\n\n2. **Result 类型**\n```typescript\ntype Result<T> = { success: true; data: T } | { success: false; error: string };\n\nfunction fetchUser(id: number): Result<User> {\n  // ...\n}\n```\n\n3. **自定义 Error 类**\n```typescript\nclass ApiError extends Error {\n  constructor(public status: number, message: string) {\n    super(message);\n  }\n}\n```\n\n推荐使用 Result 类型，它让错误处理更明确！" },
  ];

  // Add messages to session
  for (const msg of messages) {
    if (msg.role === "user") {
      session.addUserMessage(msg.content);
    } else {
      session.addAssistantMessage(msg.content);
    }
  }

  console.log(`✅ 已添加 ${messages.length} 条对话消息`);

  // Create a mock env that shows what would be sent to LLM
  let capturedPrompt = "";
  const mockEnv = {
    invokeLLM: async (messages: any[], tools: any, context: any, options: any) => {
      // Capture the prompt that would be sent
      const userMessage = messages.find((m: any) => m.role === "user");
      if (userMessage?.content?.text) {
        capturedPrompt = userMessage.content.text;
      }
      
      // Return a realistic summary
      return {
        success: true,
        output: JSON.stringify({
          user_intent: "学习 TypeScript 泛型和 API 错误处理",
          key_decisions: [
            "使用泛型创建可复用的 API 响应类型",
            "采用 Result 类型处理错误"
          ],
          current_status: "已完成 TypeScript 泛型和错误处理的学习",
          next_steps: [
            "在实际项目中应用泛型",
            "实践错误处理最佳实践"
          ],
          important_context: [
            "泛型用于 API 响应类型定义",
            "Result 类型用于错误处理",
            "提到了官方文档和几本学习资源"
          ]
        })
      };
    },
  } as any;

  // Simulate high token usage to trigger compaction
  console.log("\n🔄 模拟高 token 使用量触发压缩...");
  console.log("   (usagePercent = 85%, threshold = 80%)\n");

  await session.updateContextUsage(
    { inputTokens: 60000, outputTokens: 25000, totalTokens: 85000 },
    100000,
    mockEnv,
    "gpt-4o"
  );

  await sleep(100);

  // Show results
  const stats = session.getContextStats();
  console.log("=== 压缩结果 ===\n");
  console.log(`📊 压缩前 session: ${session.id}`);
  console.log(`   消息数量: ${session.getMessages().length}`);
  console.log(`   已压缩: ${stats?.compacted}`);
  console.log(`   压缩后 session ID: ${stats?.compactedSessionId}`);

  if (stats?.compactedSessionId) {
    const compactedSession = Session.get(stats.compactedSessionId);
    if (compactedSession) {
      console.log(`\n📝 压缩后 session: ${compactedSession.id}`);
      console.log(`   父 session: ${compactedSession.parentID}`);
      console.log(`   消息数量: ${compactedSession.getMessages().length}`);
      
      const summaryMsg = compactedSession.getMessages()[0];
      if (summaryMsg?.parts[0]?.type === "text") {
        const summaryText = (summaryMsg.parts[0] as any).text;
        console.log(`\n📋 生成的摘要:\n`);
        
        // Parse and display the JSON summary
        try {
          const parsed = JSON.parse(summaryText);
          console.log("  用户需求:");
          console.log(`    ${parsed.user_intent}\n`);
          console.log("  关键决定:");
          parsed.key_decisions?.forEach((d: string) => console.log(`    - ${d}`));
          console.log("\n  当前状态:");
          console.log(`    ${parsed.current_status}\n`);
          console.log("  后续步骤:");
          parsed.next_steps?.forEach((s: string) => console.log(`    - ${s}`));
          console.log("\n  重要上下文:");
          parsed.important_context?.forEach((c: string) => console.log(`    - ${c}`));
        } catch {
          console.log(summaryText);
        }
      }
    }
  }

  console.log("\n=== Demo 完成 ===");

  Storage.clear();
}

main().catch(console.error);
