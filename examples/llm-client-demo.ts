#!/usr/bin/env bun
/**
 * @fileoverview LLM Client Example - Direct usage with verified APIs
 *
 * Features:
 * - Multi-provider support (OpenAI, Anthropic, Kimi, DeepSeek)
 * - Uses verified invoke_llm tool internally
 *
 * Usage:
 *   bun run examples/llm-client-demo.ts "Hello"
 *   bun run examples/llm-client-demo.ts "你好" --provider kimi
 *   bun run examples/llm-client-demo.ts "What is 2+2?" --provider openai
 */

import { listAvailableProviders, getEnvVarsForProvider } from "../src/llm/provider/index.js";
import { createSystem1IntuitiveReasoning } from "../src/environment/base/invoke-llm.js";
import type { ToolInfo } from "../src/types/tool.js";

interface CLIOptions {
  provider?: string;
  model?: string;
  temperature?: number;
}

function printHelp(): void {
  console.log(`
用法: bun run examples/llm-client-demo.ts <问题> [选项]

选项:
  --provider <名称>  指定 Provider (默认: 从 LLM_MODEL 读取)
  --model <名称>     指定模型 (默认: Provider 默认模型)
  --temp <数值>      设置 temperature (0-1)
  --help, -h        显示此帮助

可用 Providers:
${listAvailableProviders()
  .map((p) => `  - ${p.id.padEnd(15)} ${p.name} (默认: ${p.defaultModel || "see docs"})`)
  .join("\n")}

环境变量:
  <PROVIDER>_API_KEY  API Key
  <PROVIDER>_BASE_URL 自定义 Base URL

示例:
  bun run examples/llm-client-demo.ts "你好"
  bun run examples/llm-client-demo.ts "Hello" --provider openai
  bun run examples/llm-client-demo.ts "What is AI?" --provider anthropic
  bun run examples/llm-client-demo.ts "介绍你自己" --provider kimi --temp 0.7
`);
}

function getProviderConfig(providerID: string): { baseURL: string; defaultModel: string } | null {
  const configs: Record<string, { baseURL: string; defaultModel: string }> = {
    openai: { baseURL: "https://api.openai.com/v1", defaultModel: "gpt-4o" },
    anthropic: { baseURL: "https://api.anthropic.com", defaultModel: "claude-sonnet-4-20250514" },
    google: { baseURL: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-2.5-flash" },
    kimi: { baseURL: "https://api.moonshot.cn/v1", defaultModel: "kimi-k2.5" },
    moonshot: { baseURL: "https://api.moonshot.cn/v1", defaultModel: "kimi-k2.5" },
    deepseek: { baseURL: "https://api.deepseek.com", defaultModel: "deepseek-chat" },
    mistral: { baseURL: "https://api.mistral.ai/v1", defaultModel: "mistral-small-latest" },
    groq: { baseURL: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile" },
    xai: { baseURL: "https://api.x.ai/v1", defaultModel: "grok-3" },
    cerebras: { baseURL: "https://api.cerebras.ai/v1", defaultModel: "llama-3.3-70b" },
    deepinfra: { baseURL: "https://api.deepinfra.com/v1/openai", defaultModel: "deepseek-chat" },
    togetherai: { baseURL: "https://api.together.ai/v1", defaultModel: "deepseek-chat" },
    perplexity: { baseURL: "https://api.perplexity.ai", defaultModel: "sonar-pro" },
    cohere: { baseURL: "https://api.cohere.ai/v1", defaultModel: "command-a" },
  };
  return configs[providerID] || null;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const options: CLIOptions = {};

  // Find the question (first non-option argument)
  const questionIndex = args.findIndex((a) => !a.startsWith("--"));
  const question = questionIndex >= 0 ? args.slice(questionIndex).join(" ") : "";

  // Parse options
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--provider" && i + 1 < args.length && i + 1 !== questionIndex) {
      options.provider = args[i + 1];
      i++;
    } else if (arg === "--model" && i + 1 < args.length && i + 1 !== questionIndex) {
      options.model = args[i + 1];
      i++;
    } else if (arg === "--temp" && i + 1 < args.length && i + 1 !== questionIndex) {
      options.temperature = parseFloat(args[i + 1]);
      i++;
    }
  }

  if (!question) {
    console.log("请提供一个问题");
    console.log("用法: bun run examples/llm-client-demo.ts <问题>\n");
    console.log("使用 --help 查看更多选项");
    process.exit(1);
  }

  // Determine provider and model
  let modelID = options.model;
  let providerID = options.provider;

  if (!providerID) {
    const envModel = process.env.LLM_MODEL || "";
    if (envModel.includes("/")) {
      const parts = envModel.split("/");
      providerID = parts[0];
      modelID = options.model || parts.slice(1).join("/");
    } else {
      providerID = "openai";
      modelID = options.model || envModel || "gpt-4o";
    }
  }

  if (!modelID) {
    const config = getProviderConfig(providerID);
    modelID = config?.defaultModel || "gpt-4o";
  }

  const fullModel = `${providerID}/${modelID}`;

  // Get API key
  const envVars = getEnvVarsForProvider(providerID);
  const apiKeyEnvVar = envVars[0]?.replace("_API_KEY", "") || providerID?.toUpperCase();
  const apiKey = process.env[`${apiKeyEnvVar}_API_KEY`] || process.env.LLM_API_KEY;

  if (!apiKey) {
    console.log(`请配置 API Key: 设置 ${envVars[0] || `${providerID?.toUpperCase()}_API_KEY`} 环境变量`);
    process.exit(1);
  }

  const baseURL = process.env[`${providerID.toUpperCase()}_BASE_URL`] || getProviderConfig(providerID)?.baseURL || "";

  console.log("╔════════════════════════════════════════════╗");
  console.log("║         LLM Client Demo                  ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log(`Provider: ${providerID}`);
  console.log(`Model: ${modelID}`);
  console.log(`Temperature: ${options.temperature ?? "default"}`);
  console.log(`Question: ${question}\n`);

  const start = Date.now();

  try {
    const config = {
      model: modelID,
      baseURL,
      apiKey,
    };

    const tool = createSystem1IntuitiveReasoning(config);

    const result = await tool.execute(
      {
        messages: [{ role: "user", content: question }],
        temperature: options.temperature,
      },
      {}
    );

    const duration = Date.now() - start;

    if (result.success) {
      console.log("🤖 Response:");
      console.log(result.output);
      console.log(`\n⏱️  耗时: ${duration}ms`);
    } else {
      console.error(`❌ Error: ${result.error}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error}`);
    process.exit(1);
  }
}

main().catch(console.error);
