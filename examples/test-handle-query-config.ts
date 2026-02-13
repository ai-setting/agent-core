/**
 * @fileoverview handle_query 配置集成测试（支持 auth.json 自动加载）
 * 
 * 验证完整的配置加载 → LLM 调用链路：
 * 1. 从 auth.json 自动加载 API key 到环境变量
 * 2. 从配置文件读取 LLM 配置（含变量引用如 ${MOONSHOT_API_KEY}）
 * 3. 解析变量为实际值（从环境变量读取）
 * 4. ServerEnvironment 使用解析后的配置初始化 LLM
 * 5. handle_query 调用真实的 LLM API
 * 
 * 使用方法：
 *   方式1：在 auth.json 中配置 API key（推荐）
 *     auth.json 会自动加载，无需手动设置环境变量
 *   
 *   方式2：手动设置环境变量
 *     Windows PowerShell: $env:MOONSHOT_API_KEY="your-key"
 *     Linux/macOS: export MOONSHOT_API_KEY="your-key"
 *   
 *   然后运行：
 *     bun run examples/test-handle-query-config.ts
 */

import { ServerEnvironment } from "../packages/core/src/server/environment.js";
import { 
  Config_get, 
  resolveConfig,
  Config_clear 
} from "../packages/core/src/config/index.js";
import * as Bus from "../packages/core/src/server/eventbus/bus.js";
import { StreamTextEvent, StreamCompletedEvent } from "../packages/core/src/server/eventbus/events/stream.js";

async function main() {
  console.log("==============================================");
  console.log("    handle_query 配置集成测试");
  console.log("==============================================\n");

  // 1. 加载配置（会自动从 auth.json 加载 API key）
  console.log("【1. 加载配置（含 auth.json 自动加载）】");
  Config_clear();
  const rawConfig = await Config_get();
  const config = await resolveConfig(rawConfig);
  
  // 检查是否有可用的 API key
  const apiKey = config.apiKey;
  if (!apiKey || apiKey.startsWith("${")) {
    console.error("✗ 错误: 未找到有效的 API Key");
    console.error("\n请在 auth.json 中配置 API key:");
    console.error("  文件位置: ~/.local/share/tong_work/agent-core/auth.json");
    console.error("\n配置示例:");
    console.error(JSON.stringify({
      "moonshot": {
        "type": "api",
        "key": "sk-your-moonshot-api-key",
        "baseURL": "https://api.moonshot.cn/v1"
      }
    }, null, 2));
    console.error("\n或者设置环境变量:");
    console.error("  $env:MOONSHOT_API_KEY=\"sk-...\"");
    process.exit(1);
  }

  console.log("✓ 配置加载成功");
  console.log("  activeEnvironment:", config.activeEnvironment);
  console.log("  defaultModel:", config.defaultModel);
  console.log("  baseURL:", config.baseURL);
  console.log("  apiKey:", apiKey.substring(0, 20) + "...");
  console.log();

  // 2. 创建 ServerEnvironment
  console.log("【2. 初始化 ServerEnvironment】");
  console.log("  正在加载配置并初始化 LLM...");
  
  const env = new ServerEnvironment({
    sessionId: "test-session-" + Date.now(),
  });

  // 订阅流式事件
  let textReceived = false;
  let fullContent = "";
  
  const unsubscribeText = Bus.subscribe(StreamTextEvent, (event: any) => {
    if (!textReceived) {
      console.log("\n[流式输出开始]");
      textReceived = true;
    }
    process.stdout.write(event.delta);
    fullContent += event.delta;
  });

  const unsubscribeComplete = Bus.subscribe(StreamCompletedEvent, (event: any) => {
    console.log("\n\n[流式输出完成]");
    if (event.usage) {
      console.log("Token 使用:");
      console.log("  prompt_tokens:", event.usage.promptTokens);
      console.log("  completion_tokens:", event.usage.completionTokens);
      console.log("  total_tokens:", event.usage.totalTokens);
    }
  });

  await env.waitForReady();
  console.log("✓ ServerEnvironment 就绪\n");

  // 3. 测试 handle_query
  console.log("【3. 测试 handle_query】");
  console.log("将使用以下配置调用 LLM:");
  console.log("  Model:", config.defaultModel);
  console.log("  Provider:", config.defaultModel?.split("/")[0]);
  console.log("  Base URL:", config.baseURL);
  console.log();

  const testQuery = "你好，请用一句话介绍自己";
  console.log("Query:", testQuery);
  console.log("Response:\n");

  textReceived = false;
  fullContent = "";
  const startTime = Date.now();

  try {
    const result = await env.handle_query(testQuery);
    const duration = Date.now() - startTime;

    if (!textReceived) {
      // 如果没有收到流式事件，直接显示结果
      console.log(result);
    }

    console.log(`\n\n[耗时: ${duration}ms]`);
    console.log(`[响应长度: ${(fullContent || result).length} 字符]`);
    console.log("\n✓ 测试成功！配置加载 → LLM 调用链路工作正常");

  } catch (error: any) {
    console.error("\n✗ 错误:", error.message);
    if (error.message.includes("401")) {
      console.error("  提示: API Key 无效或已过期");
    } else if (error.message.includes("429")) {
      console.error("  提示: 请求过于频繁");
    } else if (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED")) {
      console.error("  提示: 网络连接问题");
    }
    process.exit(1);
  }

  // 清理
  unsubscribeText();
  unsubscribeComplete();

  console.log("\n==============================================");
  console.log("测试完成！配置加载链路验证成功");
  console.log("==============================================");
  console.log("\n特性说明:");
  console.log("  ✓ 自动从 auth.json 加载 API key");
  console.log("  ✓ 支持 ${MOONSHOT_API_KEY} 变量引用");
  console.log("  ✓ ServerEnvironment 自动初始化 LLM");
  console.log("  ✓ 流式事件实时推送");
}

main().catch((error) => {
  console.error("测试失败:", error);
  process.exit(1);
});
