#!/usr/bin/env bun
/**
 * @fileoverview Demo for OS Environment Agent
 */

import { OsEnv, HistoryMessage } from "../src/index.js";

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
          if (value) process.env[key] = value;
        }
      }
    }
  } catch {
    console.warn(`Warning: Could not load .env file from ${path}`);
  }
}

async function main(): Promise<void> {
  console.log("OS Environment Agent Demo\n");

  await loadEnv(".env");

  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;

  if (!model || !apiKey) {
    console.error("Please configure LLM_MODEL and LLM_API_KEY in .env");
    process.exit(1);
  }

  const env = new OsEnv({ model, apiKey });
  await new Promise(r => setTimeout(r, 200));

  console.log(`Model: ${model}`);
  console.log(`Tools: ${env.listTools().map(t => t.name).join(", ")}\n`);

  const history: HistoryMessage[] = [];

  const result = await env.handle_query("What is 2 + 2?", undefined, history);
  console.log(`Answer: ${result}`);

  // Add to history for continued conversation
  history.push({
    role: "user",
    content: { type: "text", text: "What is 3 + 3?" }
  });
  const result2 = await env.handle_query("What is 3 + 3?", undefined, history);
  console.log(`Answer: ${result2}`);

  // Example with image (multimodal)
  console.log("\n--- Multimodal Example ---");
  history.push({
    role: "assistant",
    content: { type: "text", text: result2 }
  });
  history.push({
    role: "user",
    content: [
      { type: "text", text: "What's in this image?" },
      { type: "image", image: "https://example.com/image.png", mimeType: "image/png" }
    ]
  });
  const result3 = await env.handle_query("Analyze this image", undefined, history);
  console.log(`Answer: ${result3}`);
}

main().catch(console.error);
