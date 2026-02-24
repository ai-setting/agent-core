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

export async function loadEnvironmentConfig(
  envName: string,
  basePath?: string
): Promise<Config.Info | null> {
  // 使用传入的 basePath 或默认的 ConfigPaths.environments
  const environmentsDir = basePath || ConfigPaths.environments;
  const envDir = path.join(environmentsDir, envName);
  
  try {
    // 1. 加载主配置
    const configPath = path.join(envDir, ENV_CONFIG_FILENAME);
    const configContent = await fs.readFile(configPath, "utf-8");
    const config = parseJsoncFile(configContent, configPath) as Config.Info;
    
    // 2. 加载 Agents 配置（可选）
    const agentsPath = path.join(envDir, ENV_AGENTS_FILENAME);
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
      console.warn(`[Config] Environment "${envName}" not found at ${envDir}`);
      return null;
    }
    console.warn(`[Config] Failed to read environment config:`, error);
    return null;
  }
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
