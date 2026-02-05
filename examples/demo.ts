#!/usr/bin/env bun
/**
 * @fileoverview Demo script showing agent capabilities.
 * Runs a single query to demonstrate the agent framework.
 *
 * Usage:
 *   bun run examples/demo.ts
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
  console.log("║           Agent Core Demo (bun)                          ║");
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

  const context: Context = {
    session_id: "demo_session",
    timestamp: new Date().toISOString(),
    workdir: process.cwd(),
    metadata: {},
  };

  const queries = [
    "What is 2 + 2?",
    "Say hello in exactly one word.",
  ];

  for (const query of queries) {
    console.log(`Query: ${query}`);
    console.log("Thinking...");

    try {
      const result = await env.handle_query(query, context);
      console.log(`Answer: ${result}\n`);
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  console.log("Demo complete! 👋");
}

main().catch(console.error);
