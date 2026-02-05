#!/usr/bin/env bun
/**
 * @fileoverview Interactive chat example.
 * Multi-turn conversation with AI agent.
 *
 * Usage:
 *   bun run examples/chat.ts "What is 2 + 2?"
 *
 * Environment variables (.env):
 *   LLM_MODEL=openai/gpt-4o
 *   LLM_API_KEY=sk-your-key
 */

import { OsEnv } from "../src/environment/expand_env/os-env.js";
import type { Context } from "../src/types/index.js";

async function loadEnv(path: string): Promise<void> {
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
          if (value) {
            process.env[key] = value;
          }
        }
      }
    }
  } catch {
    console.warn(`Warning: Could not load .env file from ${path}`);
  }
}

async function main(): Promise<void> {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║           Agent Core Chat (bun)                           ║");
  console.log("╚═══════════════════════════════════════════════════════════╝\n");

  await loadEnv(".env");

  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;

  if (!model) {
    console.error("Error: LLM_MODEL not configured in .env");
    console.error("Please set LLM_MODEL in your .env file");
    process.exit(1);
  }

  if (!apiKey) {
    console.error("Error: LLM_API_KEY not configured in .env");
    console.error("Please set LLM_API_KEY in your .env file");
    process.exit(1);
  }

  console.log(`Model: ${model}\n`);

  const env = new OsEnv({
    model,
    apiKey,
    systemPrompt: "You are a helpful AI assistant.",
  });

  await new Promise(r => setTimeout(r, 200));

  const tools = env.listTools();
  console.log(`Tools: ${tools.map((t) => t.name).join(", ")}`);
  console.log(`LLM Adapter: ${env.getLLMAdapter()?.name || "none"}\n`);

  const context: Context = {
    session_id: "chat_session",
    timestamp: new Date().toISOString(),
    workdir: process.cwd(),
    metadata: {},
  };

  const query = Bun.argv.slice(2).join(" ") || "Say hello!";

  console.log(`Query: ${query}\n`);
  console.log("Thinking...\n");

  try {
    const result = await env.handle_query(query, context);
    console.log(`Answer: ${result}`);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

main().catch(console.error);
