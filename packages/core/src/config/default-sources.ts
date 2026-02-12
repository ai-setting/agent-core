import { configRegistry } from "./registry.js";
import { globalSource } from "./sources/global.js";
import { createFileSource } from "./sources/file.js";
import { createInlineSource } from "./sources/inline.js";
import { createEnvironmentSource } from "./sources/environment.js";

export function initDefaultSources(): void {
  configRegistry.clear();
  configRegistry.register(globalSource);
}

export async function initWithEnvOverrides(): Promise<void> {
  initDefaultSources();

  // 先加载 Global 配置以获取 activeEnvironment
  const globalConfig = await globalSource.load();
  const activeEnv = globalConfig?.activeEnvironment;

  // 如果指定了 activeEnvironment，注册 Environment 配置源
  if (activeEnv) {
    configRegistry.register(createEnvironmentSource(activeEnv, 10));
  }

  // Inline 内容（优先级高于 Environment）
  if (process.env.AGENT_CORE_CONFIG_CONTENT) {
    configRegistry.register(
      createInlineSource(process.env.AGENT_CORE_CONFIG_CONTENT, 100)
    );
  }

  // Custom 文件（优先级最高）
  if (process.env.AGENT_CORE_CONFIG) {
    configRegistry.register(
      createFileSource(process.env.AGENT_CORE_CONFIG, 200)
    );
  }
}
