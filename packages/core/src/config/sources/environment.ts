import path from "path";
import fs from "fs/promises";
import * as jsonc from "jsonc-parser";
import { ConfigPaths } from "../paths.js";
import type { ConfigSource } from "../source.js";
import type { Config } from "../types.js";

const ENV_CONFIG_FILENAME = "config.jsonc";
const ENV_AGENTS_FILENAME = "agents.jsonc";

function parseJsoncFile(content: string, filepath: string): unknown {
  const errors: jsonc.ParseError[] = [];
  const result = jsonc.parse(content, errors, {
    allowTrailingComma: true,
    allowEmptyContent: true,
  });
  
  if (errors.length > 0) {
    const errorMessages = errors.map(e => {
      const location = content.substring(0, e.offset).split('\n');
      const line = location.length;
      const column = location[location.length - 1].length + 1;
      return `${jsonc.printParseErrorCode(e.error)} at line ${line}, column ${column}`;
    }).join('; ');
    throw new Error(`JSONC parse error in ${filepath}: ${errorMessages}`);
  }
  
  return result;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export interface EnvironmentSearchConfig {
  searchPaths: ("local" | "global")[];
  overrides?: Record<string, string>;
}

export async function findEnvironmentPath(
  envName: string,
  searchConfig?: EnvironmentSearchConfig
): Promise<{ path: string; source: "local" | "global" } | null> {
  const searchPaths = searchConfig?.searchPaths || ["local", "global"];

  // 1. 检查 overrides（优先级最高）
  if (searchConfig?.overrides?.[envName]) {
    const overridePath = searchConfig.overrides[envName];
    if (await pathExists(overridePath)) {
      return { path: overridePath, source: "local" };
    }
  }

  // 2. 按 searchPaths 顺序搜索
  for (const sourceType of searchPaths) {
    let envPath: string;

    if (sourceType === "local") {
      envPath = path.join(ConfigPaths.projectEnvironments, envName);
    } else {
      envPath = path.join(ConfigPaths.environments, envName);
    }

    if (await pathExists(envPath)) {
      return { path: envPath, source: sourceType };
    }
  }

  return null;
}

export async function loadEnvironmentConfigFromPath(
  envPath: string,
  _source: "local" | "global" = "global"
): Promise<Config.Info | null> {
  try {
    // 1. 加载主配置
    const configPath = path.join(envPath, ENV_CONFIG_FILENAME);
    const configContent = await fs.readFile(configPath, "utf-8");
    const config = parseJsoncFile(configContent, configPath) as Config.Info;
    
    // 设置环境路径（内部字段）
    config._environmentPath = envPath;
    
    // 2. 加载 Agents 配置（可选）
    const agentsPath = path.join(envPath, ENV_AGENTS_FILENAME);
    try {
      const agentsContent = await fs.readFile(agentsPath, "utf-8");
      const agents = parseJsoncFile(agentsContent, agentsPath);
      if (Array.isArray(agents)) {
        config.agents = agents;
      }
    } catch {
      // agents.jsonc 可选
    }
    
    return config;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
      console.warn(`[Config] Environment not found at ${envPath}`);
      return null;
    }
    console.warn(`[Config] Failed to read environment config:`, error);
    return null;
  }
}

export async function loadEnvironmentConfig(
  envName: string,
  basePath?: string
): Promise<Config.Info | null> {
  // 如果传入 basePath，使用旧的单路径模式（向后兼容）
  if (basePath) {
    const envDir = path.join(basePath, envName);
    return loadEnvironmentConfigFromPath(envDir);
  }

  // 新模式：多路径搜索
  const envInfo = await findEnvironmentPath(envName);
  
  if (!envInfo) {
    console.warn(`[Config] Environment "${envName}" not found`);
    return null;
  }

  return loadEnvironmentConfigFromPath(envInfo.path, envInfo.source);
}

export function createEnvironmentSource(
  envName: string,
  priority: number = 10,
  basePath?: string
): ConfigSource {
  return {
    name: `environment:${envName}`,
    priority,
    load: () => loadEnvironmentConfig(envName, basePath),
  };
}

export function createEnvironmentSourceWithSearch(
  envName: string,
  priority: number = 10,
  searchConfig?: EnvironmentSearchConfig
): ConfigSource {
  return {
    name: `environment:${envName}`,
    priority,
    load: async () => {
      const envInfo = await findEnvironmentPath(envName, searchConfig);
      if (!envInfo) {
        return null;
      }
      return loadEnvironmentConfigFromPath(envInfo.path, envInfo.source);
    },
  };
}
