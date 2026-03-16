import { configRegistry } from "./registry.js";
import { globalSource } from "./sources/global.js";
import { providersSource } from "./sources/providers.js";
import { createFileSource } from "./sources/file.js";
import { createInlineSource } from "./sources/inline.js";
import { createEnvironmentSourceWithSearch, createEnvironmentSource } from "./sources/environment.js";
import { Auth_loadToEnv } from "./auth.js";
import { ConfigPaths } from "./paths.js";
import type { ConfigSource } from "./source.js";
import * as jsonc from "jsonc-parser";
import fs from "fs/promises";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadProjectConfig(): Promise<any | null> {
  const configPath = ConfigPaths.projectTongWorkConfig;
  
  if (!(await pathExists(configPath))) {
    return null;
  }
  
  try {
    const content = await fs.readFile(configPath, "utf-8");
    const errors: jsonc.ParseError[] = [];
    const result = jsonc.parse(content, errors, {
      allowTrailingComma: true,
      allowEmptyContent: true,
    });
    
    if (errors.length > 0) {
      console.warn(`[Config] JSONC parse errors in ${configPath}`);
      return null;
    }
    
    return result;
  } catch (error) {
    console.warn(`[Config] Failed to load project config:`, error);
    return null;
  }
}

function createProjectSource(): ConfigSource {
  return {
    name: "project",
    priority: 5,
    load: loadProjectConfig,
  };
}

export function initDefaultSources(): void {
  configRegistry.clear();
  configRegistry.register(globalSource);
  configRegistry.register(providersSource);
}

export async function initWithEnvOverrides(): Promise<void> {
  // 首先从 auth.json 加载 API key 到环境变量
  // 这确保在加载配置时，${MOONSHOT_API_KEY} 等变量可以被正确解析
  await Auth_loadToEnv();

  // 1. 注册全局配置源（优先级 0）
  configRegistry.register(globalSource);

  // 2. 注册 providers 配置源（加载 providers.jsonc）
  configRegistry.register(providersSource);

  // 3. 注册项目级配置源（优先级 5，覆盖全局）
  if (await pathExists(ConfigPaths.projectTongWorkConfig)) {
    configRegistry.register(createProjectSource());
  }

  // 3. 获取 activeEnvironment（从已加载的配置中获取）
  // 需要先 get 一次来获取合并后的配置
  const globalConfig = await globalSource.load();
  const projectConfig = await loadProjectConfig();
  const activeEnv = projectConfig?.activeEnvironment || globalConfig?.activeEnvironment;

  // 4. 注册环境配置源（优先级 10）
  if (activeEnv) {
    const searchConfig = {
      searchPaths: projectConfig?.environmentSearchPaths || ["local", "global"],
      overrides: projectConfig?.environmentOverrides,
    };
    configRegistry.register(
      createEnvironmentSourceWithSearch(activeEnv, 10, searchConfig)
    );
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
