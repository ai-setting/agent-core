/**
 * @fileoverview handle_query 集成测试
 * 
 * 测试 ServerEnvironment 使用配置加载的 LLM 参数调用 handle_query
 * 验证从配置 → LLM 初始化 → API 调用的完整链路
 */

import { ServerEnvironment } from "../packages/core/src/server/environment.js";
import { Config_get, resolveConfig } from "../packages/core/src/config/index.js";
import * as Bus from "../packages/core/src/server/eventbus/bus.js";
import { StreamTextEvent, StreamCompletedEvent } from "../packages/core/src/server/eventbus/events/stream.js";

async function main() {
  console.log("==============================================");
  console.log("    handle_query 集成测试");
  console.log("==============================================\n");

  // 1. 检查环境变量
  console.log("【1. 环境变量检查】");
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("✗ 错误: 未设置 ANTHROPIC_API_KEY 或 OPENAI_API_KEY");
    console.error("请先设置环境变量:");
    console.error("  Windows PowerShell: $env:ANTHROPIC_API_KEY=\"your-key\"");
    console.error("  Linux/macOS: export ANTHROPIC_API_KEY=\"your-key\"");
    process.exit(1);
  }
  console.log("✓ API Key 已设置\n");

  // 2. 加载并显示配置
  console.log("【2. 加载配置】");
  const rawConfig = await Config_get();
  const config = await resolveConfig(rawConfig);
  
  console.log("✓ activeEnvironment:", config.activeEnvironment);
  console.log("✓ defaultModel:", config.defaultModel);
  console.log("✓ baseURL:", config.baseURL);
  console.log("✓ apiKey:", config.apiKey?.substring(0, 15) + "...");
  console.log();

  // 3. 创建 ServerEnvironment
  console.log("【3. 初始化 ServerEnvironment】");
  const env = new ServerEnvironment({
    sessionId: "test-session-" + Date.now(),
  });

  // 订阅事件以观察流式输出
  console.log("  订阅流式事件...");
  let textReceived = false;
  const unsubscribeText = Bus.subscribe(StreamTextEvent, (event: any) => {
    if (!textReceived) {
      console.log("\n  [流式输出开始]");
      textReceived = true;
    }
    process.stdout.write(event.delta);
  });

  const unsubscribeComplete = Bus.subscribe(StreamCompletedEvent, (event: any) => {
    console.log("\n\n  [流式输出完成]");
    if (event.usage) {
      console.log("  Token 使用:", JSON.stringify(event.usage));
    }
  });

  console.log("  等待环境就绪...");
  await env.waitForReady();
  console.log("✓ ServerEnvironment 就绪\n");

  // 4. 测试 handle_query
  console.log("【4. 测试 handle_query】");
  
  const testQueries = [
    "你好，请简单介绍一下自己",
    "1 + 1 等于多少？",
  ];

  for (let i = 0; i < testQueries.length; i++) {
    const query = testQueries[i];
    console.log(`\n--- 测试 ${i + 1}/${testQueries.length} ---`);
    console.log("Query:", query);
    console.log("Response:");
    
    textReceived = false;
    const startTime = Date.now();
    
    try {
      const result = await env.handle_query(query);
      const duration = Date.now() - startTime;
      
      if (!textReceived) {
        // 如果没有收到流式事件，直接显示结果
        console.log(result);
      }
      
      console.log(`\n[耗时: ${duration}ms]`);
    } catch (error) {
      console.error("✗ 错误:", error);
    }
  }

  // 清理
  unsubscribeText();
  unsubscribeComplete();

  console.log("\n==============================================");
  console.log("测试完成！");
  console.log("==============================================");
}

main().catch((error) => {
  console.error("测试失败:", error);
  process.exit(1);
});
