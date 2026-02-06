#!/usr/bin/env bun
/**
 * @fileoverview Session Compaction Demo - Shows actual conversation content before/after
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

function printSessionMessages(session: Session, title: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log(title);
  console.log(`${"=".repeat(60)}`);
  console.log(`Session ID: ${session.id}`);
  console.log(`Messages: ${session.messageCount}\n`);

  const messages = session.getMessages();
  messages.forEach((msg, idx) => {
    const role = msg.info.role.toUpperCase().padEnd(10);
    const parts = msg.parts.map(p => {
      if (p.type === "text") return (p as any).text;
      if (p.type === "tool") return `[Tool: ${(p as any).tool}]`;
      return `[${p.type}]`;
    }).join(" ");
    const truncated = parts.substring(0, 120);
    console.log(`[${String(idx + 1).padStart(2)}] [${role}] ${truncated}${parts.length > 120 ? "..." : ""}`);
  });
}

async function main(): Promise<void> {
  console.log("Session Compaction Demo - LLM 压缩效果展示\n");

  await loadEnvConfig(".env");

  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;

  if (!model || !apiKey) {
    console.log("请配置 .env 文件中的 LLM_MODEL 和 LLM_API_KEY");
    process.exit(1);
  }

  const env = new OsEnv({ model, apiKey });
  await new Promise(r => setTimeout(r, 200));

  console.log(`Model: ${model}\n`);

  const session = Session.create({
    title: "AI Agent Development Session",
    directory: "/workspace/agent-project",
  });

  console.log("--- 构建对话历史 (12轮对话) ---\n");

  const conversation = [
    { role: "user", text: "我想开发一个 AI Agent 系统，用于自动化处理工作任务，帮我设计架构" },
    { role: "assistant", text: "架构设计：1) Environment - 环境接口封装LLM和工具；2) Session - 对话状态管理；3) History - 历史转换；4) Tool System - 工具扩展。" },
    { role: "user", text: "Session 需要实现哪些功能？" },
    { role: "assistant", text: "Session功能：创建/删除会话、添加多类型消息、父子会话关系、history转换、持久化存储。" },
    { role: "user", text: "消息类型如何设计？" },
    { role: "assistant", text: "采用Part架构：TextPart文本、ReasoningPart思考过程、ToolPart工具调用、FilePart文件附件，支持多模态。" },
    { role: "user", text: "对话历史很长怎么办？" },
    { role: "assistant", text: "用摘要压缩策略：将历史用LLM生成摘要，只保留最近K条消息+摘要，大幅减少token消耗。" },
    { role: "user", text: "压缩流程是什么？" },
    { role: "assistant", text: "压缩流程：创建子会话 -> 复制最近K条消息 -> 调用LLM生成摘要 -> 添加system消息 -> 返回子会话。" },
    { role: "user", text: "怎么触发压缩？" },
    { role: "assistant", text: "两种方式：1) 手动调用 Session.compact(env)；2) 自动触发，检查消息数/token数是否超过阈值。" },
    { role: "user", text: "压缩后怎么继续对话？" },
    { role: "assistant", text: "压缩后的会话是普通Session，直接添加消息，用toHistory()获取历史后继续调用handle_query。" },
  ];

  for (const msg of conversation) {
    if (msg.role === "user") {
      session.addUserMessage(msg.text);
    } else {
      session.addAssistantMessage(msg.text);
    }
  }

  printSessionMessages(session, "【压缩前】原始会话 (12轮对话)");

  const status = await SessionCompaction.getStatus(session, { maxMessages: 10 });
  console.log(`\n--- 状态信息 ---\n`);
  console.log(`消息数量: ${status.messageCount}`);
  console.log(`预估token数: ${status.tokenCount}`);
  console.log(`需要压缩: ${status.needsCompaction}`);

  console.log("\n" + "=".repeat(60));
  console.log("=== 第一次压缩 (keepMessages: 3) ===");
  console.log("=".repeat(60) + "\n");

  const result1 = await SessionCompaction.process(env, session, {
    keepMessages: 3,
  });

  console.log("--- 第一次压缩结果 ---\n");
  console.log(`原始消息数: ${result1.originalMessageCount}`);
  console.log(`压缩后消息数: ${result1.session?.messageCount ?? 0}`);
  console.log(`压缩率: ${((1 - (result1.session?.messageCount ?? 0) / result1.originalMessageCount) * 100).toFixed(1)}%`);

  if (result1.success && result1.session) {
    const summary1 = result1.summary ?? "无总结";
    console.log(`\n第一次总结:\n${summary1.substring(0, 200)}...\n`);

    // 重新创建新会话，确保第二次压缩是从原始会话开始的
    console.log("=".repeat(60));
    console.log("=== 第二次压缩 (keepMessages: 5) - 从原始会话重新压缩 ===");
    console.log("=".repeat(60) + "\n");

    const result2 = await SessionCompaction.process(env, session, {
      keepMessages: 5,
    });

    console.log("--- 第二次压缩结果 ---\n");
    console.log(`原始消息数: ${result2.originalMessageCount}`);
    console.log(`压缩后消息数: ${result2.session?.messageCount ?? 0}`);

    if (result2.success && result2.session) {
      const summary2 = result2.summary ?? "无总结";
      console.log(`\n第二次总结:\n${summary2.substring(0, 200)}...\n`);

      printSessionMessages(result2.session, "【最终压缩后】会话内容");

      console.log("\n" + "=".repeat(60));
      console.log("=== 对比分析 ===");
      console.log("=".repeat(60));
      console.log("\n第一次总结长度:", summary1.length, "字符");
      console.log("第二次总结长度:", summary2.length, "字符");

      const similarity = calculateSimilarity(summary1, summary2);
      console.log("相似度:", similarity.toFixed(2) + "%");
      console.log("结论:", similarity > 80 ? "相似度较高" : "差异明显 (LLM生成)");

      console.log("\n会话层级关系:");
      console.log(`原始会话: ${session.id}`);
      console.log(`第一次压缩: ${result1.session.id}`);
      console.log(`第二次压缩: ${result2.session.id}`);

      console.log("\n" + "=".repeat(60));
      console.log("=== 验证：连续压缩同一个会话 ===");
      console.log("=".repeat(60));

      const result3 = await SessionCompaction.process(env, result2.session, {
        keepMessages: 2,
      });

      if (result3.success && result3.session) {
        const summary3 = result3.summary ?? "无总结";
        console.log("\n第三次总结 (对第二次结果再压缩):");
        console.log(`${summary3.substring(0, 200)}...`);
        console.log("长度:", summary3.length, "字符");
        console.log("与第二次相似度:", calculateSimilarity(summary2, summary3).toFixed(2) + "%");
      }
    }
  }

  Storage.clear();
}

function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();
  const words1 = new Set(s1.split(/\s+/));
  const words2 = new Set(s2.split(/\s+/));
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  return (intersection.size / union.size) * 100;
}

main().catch(console.error);
