/**
 * @fileoverview 测试 auth.json 自动加载到环境变量
 * 
 * 验证配置系统会自动从 auth.json 读取 API key 并设置到环境变量
 */

import { Auth_loadToEnv, Auth_get } from "../packages/core/src/config/index.js";
import { Config_get, resolveConfig, Config_clear } from "../packages/core/src/config/index.js";

async function main() {
  console.log("==============================================");
  console.log("    auth.json 自动加载测试");
  console.log("==============================================\n");

  // 1. 显示当前环境变量状态
  console.log("【1. 当前环境变量状态（加载前）】");
  console.log("  MOONSHOT_API_KEY:", process.env.MOONSHOT_API_KEY ? "✓ 已设置" : "✗ 未设置");
  console.log("  ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY ? "✓ 已设置" : "✗ 未设置");
  console.log("  OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "✓ 已设置" : "✗ 未设置");
  console.log("  ZHIPUAI_API_KEY:", process.env.ZHIPUAI_API_KEY ? "✓ 已设置" : "✗ 未设置");
  console.log();

  // 2. 读取 auth.json 内容
  console.log("【2. 读取 auth.json】");
  const auth = await Auth_get();
  console.log("  配置项:");
  for (const [name, config] of Object.entries(auth)) {
    if (config.type === "api") {
      const keyPreview = config.key ? `${config.key.substring(0, 10)}...` : "empty";
      console.log(`    - ${name}: ${keyPreview}`);
    }
  }
  console.log();

  // 3. 执行自动加载
  console.log("【3. 执行 Auth_loadToEnv()】");
  const loadedVars = await Auth_loadToEnv();
  console.log();

  // 4. 显示加载后的环境变量状态
  console.log("【4. 环境变量状态（加载后）】");
  if (loadedVars.length > 0) {
    console.log("  已设置的变量:");
    for (const v of loadedVars) {
      console.log(`    ✓ ${v}`);
    }
  } else {
    console.log("  没有新设置变量（都已存在或 auth.json 中无有效 key）");
  }
  console.log();

  // 显示具体值
  console.log("  当前值:");
  console.log("    MOONSHOT_API_KEY:", process.env.MOONSHOT_API_KEY ? process.env.MOONSHOT_API_KEY.substring(0, 20) + "..." : "undefined");
  console.log("    ZHIPUAI_API_KEY:", process.env.ZHIPUAI_API_KEY ? process.env.ZHIPUAI_API_KEY.substring(0, 20) + "..." : "undefined");
  console.log();

  // 5. 测试配置加载（应该能解析变量了）
  console.log("【5. 测试配置加载（验证变量解析）】");
  Config_clear();
  const rawConfig = await Config_get();
  const resolvedConfig = await resolveConfig(rawConfig);
  
  console.log("  解析后的配置:");
  console.log("    defaultModel:", resolvedConfig.defaultModel);
  console.log("    baseURL:", resolvedConfig.baseURL);
  console.log("    apiKey:", resolvedConfig.apiKey ? resolvedConfig.apiKey.substring(0, 20) + "..." : "undefined");
  console.log();

  // 6. 验证 Provider 配置
  if (resolvedConfig.provider?.moonshot) {
    console.log("  Moonshot Provider:");
    console.log("    baseURL:", resolvedConfig.provider.moonshot.baseURL);
    console.log("    apiKey:", resolvedConfig.provider.moonshot.apiKey ? resolvedConfig.provider.moonshot.apiKey.substring(0, 20) + "..." : "undefined");
    console.log("    defaultModel:", resolvedConfig.provider.moonshot.defaultModel);
  }
  console.log();

  console.log("==============================================");
  console.log("测试完成！");
  console.log("==============================================");
  console.log("\n现在可以运行 handle_query 测试:");
  console.log("  bun run examples/test-handle-query-config.ts");
}

main().catch(console.error);
