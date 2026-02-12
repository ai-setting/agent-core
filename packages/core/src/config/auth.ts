/**
 * @fileoverview Auth configuration management
 * 
 * Handles authentication configuration stored in auth.json
 * Location: ~/.local/share/tong_work/agent-core/auth.json
 */

import fs from "fs/promises";
import { ConfigPaths } from "./paths.js";
import type { Config } from "./types.js";

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
