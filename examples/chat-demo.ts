#!/usr/bin/env bun
/**
 * @fileoverview Session Chat Demo - Automated Multi-turn Conversation
 *
 * Features:
 * - Session creation and message management
 * - Session compaction with LLM summary
 * - Session hierarchy (parent-child)
 * - Auto-compaction based on threshold
 *
 * Usage: bun run examples/chat-demo.ts
 */

import { Session, SessionCompaction, Storage, OsEnv } from "../src/index.js";

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
  } catch {
    console.warn(`Warning: Could not load .env file from ${path}`);
  }
}

async function demoBasicSession(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("=== 1. 基本 Session 操作 ===");
  console.log("=".repeat(60));

  const session = Session.create({
    title: "Chat Session",
    directory: "/workspace/my-project",
  });

  console.log(`\n✓ 创建会话: ${session.id}`);
  console.log(`  标题: ${session.title}`);
  console.log(`  目录: ${session.directory}`);

  session.addUserMessage("你好，我想学习编程");
  session.addAssistantMessage("好的！编程是一门很有趣的技能。");
  session.addUserMessage("我想学习 Python");
  session.addAssistantMessage("Python 是一门非常适合初学者的语言。");

  console.log(`\n✓ 添加了 4 条消息`);
  console.log(`  消息数: ${session.messageCount}`);

  console.log("\n消息列表:");
  session.getMessages().forEach((msg, idx) => {
    const role = msg.info.role.toUpperCase().padEnd(10);
    const text = (msg.parts[0] as any)?.text?.substring(0, 30) ?? "";
    console.log(`  [${idx + 1}] [${role}] ${text}...`);
  });

  console.log("\n转换为 history 格式:");
  const history = session.toHistory();
  console.log(`  历史条目数: ${history.length}`);
  console.log(`  格式: { role, content }`);
}

async function demoSessionHierarchy(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("=== 2. Session 层级关系 ===");
  console.log("=".repeat(60));

  const parent = Session.create({
    title: "Parent Session",
    directory: "/workspace/project",
  });

  parent.addUserMessage("用户问题 1");
  parent.addAssistantMessage("助手回答 1");
  parent.addUserMessage("用户问题 2");
  parent.addAssistantMessage("助手回答 2");

  console.log(`\n✓ 父会话: ${parent.id} (${parent.messageCount} 条消息)`);

  const child = Session.createChild(parent.id, "Child Session");
  console.log(`\n✓ 子会话: ${child.id}`);
  console.log(`  父会话ID: ${child.parentID}`);

  child.addUserMessage("用户问题 3");
  child.addAssistantMessage("助手回答 3");

  console.log(`\n子会话消息数: ${child.messageCount}`);

  console.log("\n层级结构:");
  console.log(`  父会话: ${parent.id}`);
  console.log(`    └── 子会话: ${child.id}`);

  const children = Session.getChildren(parent.id);
  console.log(`\n父会话的子会话数: ${children.length}`);
}

async function demoCompaction(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("=== 3. Session 压缩演示 ===");
  console.log("=".repeat(60));

  const session = Session.create({
    title: "Compaction Demo",
    directory: "/workspace/demo",
  });

  const conversation = [
    "我想开发一个 AI Agent 系统，请帮我设计架构",
    "AI Agent 架构：Environment、Session、History、Tool System",
    "Session 需要实现哪些功能？",
    "Session 功能：创建会话、添加消息、父子关系、history 转换",
    "对话历史很长怎么办？",
    "用摘要压缩策略：LLM 生成摘要 + 保留最近 K 条消息",
    "压缩流程是什么？",
    "创建子会话 → 复制消息 → LLM 生成摘要 → 添加 system 消息",
    "怎么触发压缩？",
    "手动调用或自动触发（基于消息数/token 阈值）",
    "压缩后怎么继续对话？",
    "压缩后是普通 Session，直接添加消息即可",
  ];

  for (let i = 0; i < conversation.length; i += 2) {
    session.addUserMessage(conversation[i]);
    if (i + 1 < conversation.length) {
      session.addAssistantMessage(conversation[i + 1]);
    }
  }

  console.log(`\n✓ 创建了 ${conversation.length} 轮对话`);
  console.log(`  消息数: ${session.messageCount}`);

  const status = await SessionCompaction.getStatus(session, { maxMessages: 10 });
  console.log(`  预估 Token: ${status.tokenCount}`);
  console.log(`  需要压缩: ${status.needsCompaction}`);

  const mockEnv = {
    handle_query: async (input: string, ctx: any, history: any[]) => {
      return `Summary: 对话涵盖 AI Agent 系统架构设计，包括 Session 管理、消息类型设计、压缩机制。系统采用 Part 架构，通过创建子会话并添加 AI 摘要实现上下文压缩。`;
    },
  } as any;

  console.log("\n执行压缩 (keepMessages: 2)...\n");

  const result = await SessionCompaction.process(mockEnv, session, {
    keepMessages: 2,
    customPrompt: "简洁总结对话内容",
  });

  if (result.success && result.session) {
    const compacted = result.session;

    console.log(`✓ 压缩成功!`);
    console.log(`  原始消息: ${result.originalMessageCount}`);
    console.log(`  压缩后: ${compacted.messageCount}`);
    console.log(`  压缩率: ${((1 - compacted.messageCount / result.originalMessageCount) * 100).toFixed(1)}%`);

    console.log("\n会话层级:");
    console.log(`  原始会话: ${session.id}`);
    console.log(`  压缩后会话: ${compacted.id}`);
    console.log(`  父会话ID: ${compacted.parentID}`);
    console.log(`  目录: ${compacted.directory}`);

    console.log("\n继续对话:");
    compacted.addUserMessage("下一步应该做什么？");
    compacted.addAssistantMessage("下一步：1) 实现持久化 2) 配置化压缩条件 3) 完善多模态");

    console.log(`  继续后消息数: ${compacted.messageCount}`);
    console.log(`  history 条目数: ${compacted.toHistory().length}`);
  }
}

async function demoAutoCompaction(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("=== 4. 自动压缩演示 ===");
  console.log("=".repeat(60));

  let session = Session.create({
    title: "Auto Compaction Demo",
    directory: "/workspace/auto",
  });

  const mockEnv = {
    handle_query: async (input: string, ctx: any, history: any[]) => {
      return `Auto Summary: 对话持续进行中...`;
    },
  } as any;

  const maxMessages = 5;
  console.log(`\n压缩阈值: ${maxMessages} 条消息`);

  let round = 1;

  for (let i = 1; i <= 10; i++) {
    session.addUserMessage(`问题 ${i}`);
    session.addAssistantMessage(`回答 ${i}`);

    const messageNum = session.messageCount;

    const status = await SessionCompaction.getStatus(session, {
      maxMessages,
    });

    if (status.needsCompaction) {
      console.log(`\n第 ${i} 轮: 消息数 ${messageNum} 超过阈值，自动压缩...`);

      const result = await SessionCompaction.process(mockEnv, session, {
        keepMessages: 2,
      });

      if (result.success && result.session) {
        session = result.session;
        console.log(`  ✓ 压缩到 ${session.messageCount} 条消息`);
        round++;
      }
    } else {
      if (i % 2 === 0) {
        console.log(`第 ${i} 轮: 消息数 ${messageNum}`);
      }
    }
  }

  console.log(`\n最终消息数: ${session.messageCount}`);
  console.log(`会话ID: ${session.id}`);
  console.log(`产生的压缩次数: ${round - 1}`);
}

async function demoRealLLMCompaction(): Promise<void> {
  console.log("\n" + "=".repeat(60));
  console.log("=== 5. 真实 LLM 压缩演示 ===");
  console.log("=".repeat(60));

  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;

  if (!model || !apiKey) {
    console.log("\n⚠️  未配置 LLM，跳过此演示");
    console.log("请在 .env 中配置 LLM_MODEL 和 LLM_API_KEY");
    return;
  }

  const env = new OsEnv({ model, apiKey });
  await new Promise(r => setTimeout(r, 200));

  console.log(`\nModel: ${model}`);

  let session = Session.create({
    title: "Real LLM Compaction",
    directory: "/workspace/real",
  });

  const topics = [
    "什么是 TypeScript？",
    "TypeScript 是 JavaScript 的超集，添加了静态类型检查",
    "TypeScript 的优势是什么？",
    "类型安全、更好的 IDE 支持、更早发现错误",
    "如何安装 TypeScript？",
    "npm install -g typescript 或 bun add -d typescript",
    "tsconfig.json 怎么配置？",
    "设置 target、module、strict 等选项",
    "TypeScript 泛型怎么用？",
    "泛型让函数和类可以支持多种类型",
  ];

  for (let i = 0; i < topics.length; i += 2) {
    session.addUserMessage(topics[i]);
    if (i + 1 < topics.length) {
      session.addAssistantMessage(topics[i + 1]);
    }
  }

  console.log(`\n✓ 创建了 ${topics.length / 2} 轮对话`);
  console.log(`  消息数: ${session.messageCount}`);

  console.log("\n执行 LLM 压缩 (keepMessages: 2)...\n");

  const result = await SessionCompaction.process(env, session, {
    keepMessages: 2,
    customPrompt: "用简洁的中文总结对话内容，包含主要知识点",
  });

  if (result.success && result.session) {
    const compacted = result.session;

    console.log(`✓ LLM 压缩成功!`);
    console.log(`  原始消息: ${result.originalMessageCount}`);
    console.log(`  压缩后: ${compacted.messageCount}`);
    console.log(`  压缩率: ${((1 - compacted.messageCount / result.originalMessageCount) * 100).toFixed(1)}%`);

    console.log("\nLLM 生成的总结:");
    console.log(result.summary?.substring(0, 200) + "...");

    console.log("\n会话层级:");
    console.log(`  原始: ${session.id}`);
    console.log(`  压缩: ${compacted.id}`);
  }
}

async function main(): Promise<void> {
  console.clear();
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║       Session Chat Demo - Session 管理和压缩演示           ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  await loadEnvConfig(".env");

  await demoBasicSession();
  await demoSessionHierarchy();
  await demoCompaction();
  await demoAutoCompaction();
  await demoRealLLMCompaction();

  console.log("\n" + "=".repeat(60));
  console.log("=== 演示完成 ===");
  console.log("=".repeat(60));
  console.log(`
功能总结:
1. Session 用于管理对话状态和历史
2. 支持父子会话关系，便于分支和压缩
3. Compaction 将长对话压缩为摘要 + 上下文
4. 可配置自动压缩阈值，实现智能上下文管理
5. 保留层级关系和目录信息
`);

  Storage.clear();
}

main().catch(console.error);
