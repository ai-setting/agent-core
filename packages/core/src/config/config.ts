import { loadConfig } from "./loader.js";
import { initWithEnvOverrides } from "./default-sources.js";
import type { Config } from "./types.js";

// 内部缓存
let cachedConfig: Config.Info | null = null;
let configLoaded = false;
let initializationPromise: Promise<void> | null = null;

// 配置变更监听器
const listeners: Set<(config: Config.Info) => void> = new Set();

/**
 * 初始化配置系统
 */
async function ensureInitialized(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise;
  }
  
  initializationPromise = initWithEnvOverrides();
  return initializationPromise;
}

/**
 * 获取合并后的配置
 * 首次调用会触发配置加载，后续调用返回缓存
 */
export async function Config_get(): Promise<Config.Info> {
  if (!configLoaded) {
    await ensureInitialized();
    cachedConfig = await loadConfig();
    configLoaded = true;
  }
  return cachedConfig ?? {};
}

/**
 * 强制重新加载配置
 * 用于配置变更后刷新
 */
export async function Config_reload(): Promise<Config.Info> {
  cachedConfig = null;
  configLoaded = false;
  return Config_get();
}

/**
 * 清除配置缓存
 * 下次 Config_get() 会重新加载
 */
export function Config_clear(): void {
  cachedConfig = null;
  configLoaded = false;
}

/**
 * 同步获取配置（仅当配置已加载时可用）
 * 适用于配置加载完成后的场景
 */
export function Config_getSync(): Config.Info | null {
  return cachedConfig;
}

/**
 * 订阅配置变更
 * @param callback 配置变更回调
 * @returns 取消订阅函数
 */
export function Config_onChange(callback: (config: Config.Info) => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * 触发配置变更通知
 * 在配置被修改后调用，通知所有监听器
 */
export function Config_notifyChange(config: Config.Info): void {
  cachedConfig = config;
  listeners.forEach(cb => cb(config));
}
