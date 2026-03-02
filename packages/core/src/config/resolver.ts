/**
 * @fileoverview Variable resolver for config values
 * 
 * Resolves variable references like ${auth:provider-name} or ${ENV_VAR}
 * in configuration files.
 * 
 * Supported variables:
 * - ${auth:provider-name} -> Resolve from auth.json
 * - ${ENV_VAR} -> Resolve from environment variables
 * - ${PROJECT_ROOT} -> Environment root directory
 * - ${HOME} -> User home directory
 */

import type { Config } from "./types.js";
import { Auth_getProvider } from "./auth.js";
import path from "path";
import os from "os";

// Variable reference pattern: ${auth:provider-name} or ${ENV_VAR}
const VAR_PATTERN = /\$\{([^}]+)\}/g;

interface ResolveOptions {
  projectRoot?: string;  // Environment root directory
}

/**
 * Resolve a single variable reference
 * Supported formats:
 * - ${auth:provider-name} -> Resolve from auth.json
 * - ${ENV_VAR} -> Resolve from environment variables
 * - ${PROJECT_ROOT} -> Environment root directory
 * - ${HOME} -> User home directory
 */
async function resolveVariable(ref: string, options?: ResolveOptions): Promise<string | undefined> {
  const trimmed = ref.trim();

  // PROJECT_ROOT: Environment root directory
  if (trimmed === "PROJECT_ROOT") {
    return options?.projectRoot;
  }

  // HOME: User home directory
  if (trimmed === "HOME") {
    return os.homedir();
  }

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
export async function resolveValue(value: string, options?: ResolveOptions): Promise<string> {
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
    const resolved = await resolveVariable(ref, options);
    if (resolved !== undefined) {
      result = result.replace(full, resolved);
    }
  }

  return result;
}

/**
 * Recursively resolve all variable references in an object
 */
export async function resolveObject<T extends Record<string, unknown>>(obj: T, options?: ResolveOptions): Promise<T> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = await resolveValue(value, options);
    } else if (Array.isArray(value)) {
      result[key] = await Promise.all(
        value.map(async (item) => {
          if (typeof item === "string") {
            return await resolveValue(item, options);
          } else if (typeof item === "object" && item !== null) {
            return await resolveObject(item as Record<string, unknown>, options);
          }
          return item;
        })
      );
    } else if (typeof value === "object" && value !== null) {
      result[key] = await resolveObject(value as Record<string, unknown>, options);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Resolve variable references in Config.Info
 * Specifically handles apiKey, baseURL, and providers configurations
 * 
 * @param projectRoot - Environment root directory for ${PROJECT_ROOT} resolution
 */
export async function resolveConfig(config: Config.Info, projectRoot?: string): Promise<Config.Info> {
  const options: ResolveOptions = { projectRoot };
  const resolved = { ...config };

  // Resolve top-level apiKey and baseURL
  if (resolved.apiKey) {
    resolved.apiKey = await resolveValue(resolved.apiKey, options);
  }
  if (resolved.baseURL) {
    resolved.baseURL = await resolveValue(resolved.baseURL, options);
  }

  // Resolve providers configurations (providers.jsonc)
  if (resolved.providers) {
    for (const [name, provider] of Object.entries(resolved.providers)) {
      if (provider.apiKey) {
        provider.apiKey = await resolveValue(provider.apiKey, options);
      }
      if (provider.baseURL) {
        provider.baseURL = await resolveValue(provider.baseURL, options);
      }
    }
  }

  return resolved;
}
