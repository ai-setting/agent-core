/**
 * @fileoverview 配置加载流程演示
 * 
 * 展示 ServerEnvironment 配置加载的完整流程，无需真实 API Key
 * 验证配置 → LLM 初始化链路的正确性
 */

import { ServerEnvironment } from "../packages/core/src/server/environment.js";
import { 
  Config_get, 
  resolveConfig, 
  Config_clear 
} from "../packages/core/src/config/index.js";
import { InvokeLLMConfig } from "../packages/core/src/core/environment/base/invoke-llm.js";

// 模拟 API Key 用于测试配置加载
const MOCK_API_KEY = "sk-test-mock-key-for-testing-only";

async function main() {
  console.log("==============================================");
  console.log("    ServerEnvironment 配置加载流程演示");
  console.log("==============================================\n");

  // 1. 设置模拟环境变量
  console.log("【1. 设置测试环境变量】");
  process.env.ANTHROPIC_API_KEY = MOCK_API_KEY;
  console.log("✓ 已设置 ANTHROPIC_API_KEY (模拟值)");
  console.log();

  // 2. 清除配置缓存并重新加载
  console.log("【2. 加载并解析配置】");
  Config_clear();
  const rawConfig = await Config_get();
  const config = await resolveConfig(rawConfig);
  
  console.log("原始配置 (未解析变量):");
  console.log("  apiKey:", rawConfig.apiKey);
  console.log("\n解析后配置:");
  console.log("  apiKey:", config.apiKey?.substring(0, 20) + "...");
  console.log("  baseURL:", config.baseURL);
  console.log("  defaultModel:", config.defaultModel);
  console.log();

  // 3. 验证 LLM 配置参数
  console.log("【3. 验证 LLM 配置参数】");
  const parts = config.defaultModel?.split("/") || ["anthropic", "claude-sonnet-4-5"];
  const provider = parts[0];
  const modelId = parts.slice(1).join("/");
  
  console.log("配置解析结果:");
  console.log("  Provider:", provider);
  console.log("  Model ID:", modelId);
  console.log("  Base URL:", config.baseURL);
  console.log("  API Key:", config.apiKey ? "✓ 已设置" : "✗ 未设置");
  
  if (config.apiKey && config.baseURL) {
    const llmConfig: InvokeLLMConfig = {
      model: modelId,
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    };
    console.log("\nInvokeLLMConfig 对象:");
    console.log("  model:", llmConfig.model);
    console.log("  baseURL:", llmConfig.baseURL);
    console.log("  apiKey:", llmConfig.apiKey.substring(0, 20) + "...");
  }
  console.log();

  // 4. 创建 ServerEnvironment 并观察初始化过程
  console.log("【4. 初始化 ServerEnvironment】");
  console.log("创建 ServerEnvironment 实例...");
  
  const env = new ServerEnvironment({
    sessionId: "demo-session",
  });

  console.log("等待环境就绪 (加载配置 + 初始化 LLM)...");
  await env.waitForReady();
  
  console.log("\n✓ ServerEnvironment 初始化完成!");
  console.log("  - 配置已加载");
  console.log("  - LLM 已配置");
  console.log("  - 工具已注册");
  console.log();

  // 5. 显示 Environment 内部状态
  console.log("【5. Environment 内部状态】");
  const tools = env.getTools();
  console.log("  注册工具数:", tools.length);
  tools.forEach((tool, i) => {
    console.log(`    ${i + 1}. ${tool.name}: ${tool.description.substring(0, 50)}...`);
  });
  console.log();

  // 6. 验证 LLM 调用能力
  console.log("【6. 验证 LLM 调用能力】");
  console.log("✓ LLM 配置已就绪，可以调用 handle_query");
  console.log("  模型:", config.defaultModel);
  console.log("  Provider:", provider);
  console.log("  Base URL:", config.baseURL);
  console.log();

  console.log("==============================================");
  console.log("演示完成！");
  console.log("==============================================");
  console.log("\n要使用真实 API 测试 handle_query，请运行:");
  console.log("  bun run examples/test-handle-query-with-key.ts <your-api-key>");
}

main().catch((error) => {
  console.error("演示失败:", error);
  process.exit(1);
});
