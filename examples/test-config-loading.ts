/**
 * @fileoverview 配置加载测试脚本
 * 
 * 测试 ServerEnvironment 的配置加载逻辑：
 * 1. 加载全局配置 (tong_work.jsonc)
 * 2. 加载 Environment 配置 (server_env/)
 * 3. 解析变量引用 (${ENV_VAR})
 * 4. 验证配置合并结果
 */

import { 
  Config_get, 
  Config_reload, 
  resolveConfig,
  loadEnvironmentConfig,
  ConfigPaths 
} from "../packages/core/src/config/index.js";
import path from "path";

async function main() {
  console.log("==============================================");
  console.log("    ServerEnvironment 配置加载测试");
  console.log("==============================================\n");

  // 0. 显示配置路径
  console.log("【0. 配置路径信息】");
  console.log("  配置根目录:", ConfigPaths.config);
  console.log("  Environment目录:", ConfigPaths.environments);
  console.log("  状态目录:", ConfigPaths.state);
  console.log("  数据目录:", ConfigPaths.data);
  console.log();

  // 1. 加载并显示原始配置（未解析变量）
  console.log("【1. 加载全局 + Environment 配置（未解析变量）】");
  const rawConfig = await Config_get();
  
  console.log("  ✓ activeEnvironment:", rawConfig.activeEnvironment);
  console.log("  ✓ defaultModel:", rawConfig.defaultModel);
  console.log("  ✓ baseURL:", rawConfig.baseURL);
  console.log("  ✓ apiKey (原始值):", rawConfig.apiKey);
  console.log();

  // 2. 显示 Provider 配置
  console.log("【2. Provider 配置（未解析变量）】");
  if (rawConfig.provider) {
    for (const [name, provider] of Object.entries(rawConfig.provider)) {
      console.log(`  Provider: ${name}`);
      console.log(`    - baseURL: ${provider.baseURL}`);
      console.log(`    - apiKey (原始): ${provider.apiKey}`);
      console.log(`    - defaultModel: ${provider.defaultModel}`);
    }
  }
  console.log();

  // 3. 解析变量后的配置
  console.log("【3. 解析变量后的配置】");
  const resolvedConfig = await resolveConfig(rawConfig);
  
  console.log("  ✓ apiKey (解析后):", resolvedConfig.apiKey?.substring(0, 20) + "...");
  console.log("  ✓ baseURL (解析后):", resolvedConfig.baseURL);
  console.log();

  // 显示解析后的 Provider 配置
  console.log("【4. Provider 配置（解析后）】");
  if (resolvedConfig.provider) {
    for (const [name, provider] of Object.entries(resolvedConfig.provider)) {
      console.log(`  Provider: ${name}`);
      console.log(`    - baseURL: ${provider.baseURL}`);
      const maskedKey = provider.apiKey 
        ? provider.apiKey.substring(0, 10) + "..." + provider.apiKey.substring(provider.apiKey.length - 4)
        : "undefined";
      console.log(`    - apiKey (解析后): ${maskedKey}`);
      console.log(`    - defaultModel: ${provider.defaultModel}`);
    }
  }
  console.log();

  // 4. 加载 Environment 专属配置
  console.log("【5. Environment 专属配置 (server_env/)】");
  const envConfig = await loadEnvironmentConfig("server_env");
  
  if (envConfig) {
    console.log("  ✓ Environment ID:", envConfig.environment?.id);
    console.log("  ✓ Display Name:", envConfig.environment?.displayName);
    console.log("  ✓ Description:", envConfig.environment?.description);
    console.log("  ✓ Capabilities:", JSON.stringify(envConfig.environment?.capabilities, null, 2));
    console.log("  ✓ Profiles 数量:", envConfig.environment?.profiles?.length || 0);
    console.log("  ✓ Agents 数量:", envConfig.agents?.length || 0);
  } else {
    console.log("  ✗ 未找到 server_env 配置");
  }
  console.log();

  // 5. 环境变量检查
  console.log("【6. 环境变量检查】");
  const envVars = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY", 
    "ZHIPUAI_API_KEY",
    "MOONSHOT_API_KEY",
    "OLLAMA_BASE_URL"
  ];
  
  for (const envVar of envVars) {
    const value = process.env[envVar];
    const status = value ? "✓ 已设置" : "✗ 未设置";
    const display = value 
      ? value.substring(0, 10) + "..." + value.substring(value.length - 4)
      : "undefined";
    console.log(`  ${status} ${envVar}: ${display}`);
  }
  console.log();

  // 6. 总结
  console.log("【7. 配置加载流程总结】");
  console.log("  1. Global配置 (tong_work.jsonc)");
  console.log(`     - 设置 activeEnvironment: "${rawConfig.activeEnvironment}"`);
  console.log("  2. Environment配置 (server_env/config.jsonc)");
  console.log("     - 覆盖 Global 的模型配置");
  console.log("  3. 变量解析");
  console.log("     - ${ANTHROPIC_API_KEY} → 从环境变量读取");
  console.log("     - ${OPENAI_API_KEY} → 从环境变量读取");
  console.log("  4. ServerEnvironment 使用解析后的配置初始化 LLM");
  console.log();

  console.log("==============================================");
  console.log("测试完成！");
  console.log("==============================================");
}

main().catch(console.error);
