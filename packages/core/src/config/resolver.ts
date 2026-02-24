/**
 * @fileoverview Variable resolver for config values
 * 
 * Resolves variable references like ${auth:provider-name} or ${ENV_VAR}
 * in configuration files.
 */

import type { Config } from "./types.js";
import { Auth_getProvider } from "./auth.js";

// Variable reference pattern: ${auth:provider-name} or ${ENV_VAR}
const VAR_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Resolve a single variable reference
 * Supported formats:
 * - ${auth:provider-name} -> Resolve from auth.json
 * - ${ENV_VAR} -> Resolve from environment variables
 */
async function resolveVariable(ref: string): Promise<string | undefined> {
  const trimmed = ref.trim();

  // Auth reference: ${auth:provider-name}
  if (trimmed.startsWith("auth:")) {
    const providerName = trimmed.slice(5); // Remove "auth:" prefix
    const auth = await Auth_getProvider(providerName);
    if (auth?.type === "api") {
      return auth.key;
    }
    console.warn(`[Config] Auth provider "${providerName}" not found or invalid`);
    return undefined;
  }

  // Environment variable: ${ENV_VAR}
  const envValue = process.env[trimmed];
  if (envValue !== undefined) {
    return envValue;
  }

  console.warn(`[Config] Environment variable "${trimmed}" not found`);
  return undefined;
}

/**
 * Resolve all variable references in a string value
 */
export async function resolveValue(value: string): Promise<string> {
  if (!value.includes("${")) {
    return value;
  }

  const matches: Array<{ full: string; ref: string }> = [];
  let match;

  // Find all variable references
  VAR_PATTERN.lastIndex = 0;
  while ((match = VAR_PATTERN.exec(value)) !== null) {
    matches.push({ full: match[0], ref: match[1] });
  }

  // Resolve each reference
  let result = value;
  for (const { full, ref } of matches) {
    const resolved = await resolveVariable(ref);
    if (resolved !== undefined) {
      result = result.replace(full, resolved);
    }
  }

  return result;
}

/**
 * Recursively resolve all variable references in an object
 */
export async function resolveObject<T extends Record<string, unknown>>(obj: T): Promise<T> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = await resolveValue(value);
    } else if (Array.isArray(value)) {
      result[key] = await Promise.all(
        value.map(async (item) => {
          if (typeof item === "string") {
            return await resolveValue(item);
          } else if (typeof item === "object" && item !== null) {
            return await resolveObject(item as Record<string, unknown>);
          }
          return item;
        })
      );
    } else if (typeof value === "object" && value !== null) {
      result[key] = await resolveObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Resolve variable references in Config.Info
 * Specifically handles apiKey, baseURL, and providers configurations
 */
export async function resolveConfig(config: Config.Info): Promise<Config.Info> {
  const resolved = { ...config };

  // Resolve top-level apiKey and baseURL
  if (resolved.apiKey) {
    resolved.apiKey = await resolveValue(resolved.apiKey);
  }
  if (resolved.baseURL) {
    resolved.baseURL = await resolveValue(resolved.baseURL);
  }

  // Resolve providers configurations (providers.jsonc)
  if (resolved.providers) {
    for (const [name, provider] of Object.entries(resolved.providers)) {
      if (provider.apiKey) {
        provider.apiKey = await resolveValue(provider.apiKey);
      }
      if (provider.baseURL) {
        provider.baseURL = await resolveValue(provider.baseURL);
      }
    }
  }

  return resolved;
}
