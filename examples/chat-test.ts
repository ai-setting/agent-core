#!/usr/bin/env bun
/**
 * @fileoverview Simple chat test with LLM
 *
 * Usage: bun run examples/chat-test.ts "your question"
 */

import { Session, OsEnv } from "../src/index.js";
import { createInterface } from "node:readline";

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

async function main(): Promise<void> {
  await loadEnvConfig(".env");

  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;

  if (!model || !apiKey) {
    console.log("请在 .env 中配置 LLM_MODEL 和 LLM_API_KEY");
    process.exit(1);
  }

  const question = process.argv[2] || "你好，请介绍一下TypeScript";

  console.log(`Model: ${model}`);
  console.log(`问题: ${question}\n`);

  const env = new OsEnv({ model, apiKey });
  await new Promise((r) => setTimeout(r, 200));

  const session = Session.create({ title: "Chat", directory: process.cwd() });

  try {
    const start = Date.now();
    const response = await env.handle_query(question, {}, []);
    const duration = Date.now() - start;

    session.addUserMessage(question);
    session.addAssistantMessage(response);

    console.log(`🤖 ${response}\n`);
    console.log(`耗时: ${duration}ms`);
    console.log(`消息数: ${session.messageCount}`);
  } catch (error) {
    console.log(`[错误] ${error}`);
  }
}

main().catch(console.error);
