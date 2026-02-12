/**
 * @fileoverview Auth configuration management
 * 
 * Handles authentication configuration stored in auth.json
 * Location: ~/.local/share/tong_work/agent-core/auth.json
 */

import fs from "fs/promises";
import { ConfigPaths } from "./paths.js";
import type { Config } from "./types.js";

// Provider 到环境变量名的映射
const PROVIDER_ENV_MAP: Record<string, string> = {
  "anthropic": "ANTHROPIC_API_KEY",
  "anthropic-claude": "ANTHROPIC_API_KEY",
  "openai": "OPENAI_API_KEY",
  "openai-gpt": "OPENAI_API_KEY",
  "moonshot": "MOONSHOT_API_KEY",
  "kimi": "MOONSHOT_API_KEY",
  "kimi-for-coding": "MOONSHOT_API_KEY",
  "zhipuai": "ZHIPUAI_API_KEY",
  "zhipuai-coding-plan": "ZHIPUAI_API_KEY",
  "deepseek": "DEEPSEEK_API_KEY",
  "ollama": "OLLAMA_API_KEY",
};

// 内部缓存
let cachedAuth: Config.Auth | null = null;
let authLoaded = false;

/**
 * Clear auth cache (for testing purposes)
 */
export function Auth_clearCache(): void {
  cachedAuth = null;
  authLoaded = false;
}

/**
 * Load auth configuration from auth.json
 */
export async function loadAuthConfig(): Promise<Config.Auth> {
  try {
    const content = await fs.readFile(ConfigPaths.authStore, "utf-8");
    // Handle empty file
    if (!content.trim()) {
      return {};
    }
    const parsed = JSON.parse(content);
    return parsed as Config.Auth;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
      // File doesn't exist, return empty object
      return {};
    }
    console.warn("[Auth] Failed to load auth config:", error);
    return {};
  }
}

/**
 * Get auth configuration (with caching)
 */
export async function Auth_get(): Promise<Config.Auth> {
  if (!authLoaded) {
    cachedAuth = await loadAuthConfig();
    authLoaded = true;
  }
  return cachedAuth ?? {};
}

/**
 * Reload auth configuration
 */
export async function Auth_reload(): Promise<Config.Auth> {
  cachedAuth = null;
  authLoaded = false;
  return Auth_get();
}

/**
 * Get API key for a specific provider
 */
export async function Auth_getApiKey(providerName: string): Promise<string | undefined> {
  const auth = await Auth_get();
  const providerAuth = auth[providerName];
  if (providerAuth && providerAuth.type === "api") {
    return providerAuth.key;
  }
  return undefined;
}

/**
 * Get full auth config for a provider
 */
export async function Auth_getProvider(providerName: string): Promise<Config.Auth[string] | undefined> {
  const auth = await Auth_get();
  return auth[providerName];
}

/**
 * List all configured providers
 */
export async function Auth_listProviders(): Promise<string[]> {
  const auth = await Auth_get();
  return Object.keys(auth);
}

/**
 * Save auth configuration
 */
export async function Auth_save(auth: Config.Auth): Promise<void> {
  const dir = ConfigPaths.data;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(ConfigPaths.authStore, JSON.stringify(auth, null, 2));
  cachedAuth = auth;
  authLoaded = true;
}

/**
 * Add or update a provider's auth config
 */
export async function Auth_setProvider(
  providerName: string,
  config: Config.Auth[string]
): Promise<void> {
  const auth = await Auth_get();
  auth[providerName] = config;
  await Auth_save(auth);
}

/**
 * Remove a provider's auth config
 */
export async function Auth_removeProvider(providerName: string): Promise<void> {
  const auth = await Auth_get();
  delete auth[providerName];
  await Auth_save(auth);
}

/**
 * 从 auth.json 加载 API key 并设置到环境变量
 * 如果环境变量已存在，则不会覆盖
 * 
 * @returns 设置的变量列表
 */
export async function Auth_loadToEnv(): Promise<string[]> {
  const auth = await Auth_get();
  const setVars: string[] = [];

  for (const [providerName, providerConfig] of Object.entries(auth)) {
    if (providerConfig.type !== "api" || !providerConfig.key) {
      continue;
    }

    // 获取对应的环境变量名
    const envVarName = PROVIDER_ENV_MAP[providerName];
    if (!envVarName) {
      // 尝试根据 provider 名称推断环境变量名
      const inferredName = `${providerName.toUpperCase().replace(/-/g, "_")}_API_KEY`;
      if (!process.env[inferredName]) {
        process.env[inferredName] = providerConfig.key;
        setVars.push(`${providerName} -> ${inferredName}`);
        console.log(`[Auth] 设置环境变量: ${inferredName}`);
      }
      continue;
    }

    // 如果环境变量不存在，则从 auth.json 设置
    if (!process.env[envVarName]) {
      process.env[envVarName] = providerConfig.key;
      setVars.push(`${providerName} -> ${envVarName}`);
      console.log(`[Auth] 设置环境变量: ${envVarName}`);
    } else {
      console.log(`[Auth] 环境变量 ${envVarName} 已存在，跳过`);
    }
  }

  if (setVars.length > 0) {
    console.log(`[Auth] 已从 auth.json 加载 ${setVars.length} 个 API key 到环境变量`);
  } else {
    console.log("[Auth] 没有新的 API key 需要加载（都已存在或 auth.json 为空）");
  }

  return setVars;
}

/**
 * 获取特定 provider 对应的环境变量名
 */
export function Auth_getEnvVarName(providerName: string): string | undefined {
  return PROVIDER_ENV_MAP[providerName];
}
