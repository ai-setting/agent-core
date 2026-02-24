import fs from "fs/promises";
import path from "path";
import * as jsonc from "jsonc-parser";
import { ConfigPaths } from "../paths.js";
import type { ConfigSource } from "../source.js";

function getProvidersConfigPath(): string {
  return path.join(ConfigPaths.config, "providers.jsonc");
}

export interface ProviderConfig {
  id?: string;
  name: string;
  description?: string;
  baseURL: string;
  apiKey?: string;
  models?: string[];
  defaultModel?: string;
}

export interface ProvidersConfig {
  defaultModel?: string;
  providers: Record<string, ProviderConfig>;
}

export async function loadProvidersConfig(): Promise<ProvidersConfig | null> {
  try {
    const content = await fs.readFile(getProvidersConfigPath(), "utf-8");
    
    if (!content.trim()) {
      return null;
    }
    
    const errors: jsonc.ParseError[] = [];
    const parsed = jsonc.parse(content, errors, {
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
      console.warn("[Config] JSONC parse errors in providers.jsonc:", errorMessages);
    }
    
    return parsed as ProvidersConfig;
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
      return null;
    }
    console.warn("[Config] Failed to load providers.jsonc:", error);
    return null;
  }
}

export const providersSource: ConfigSource = {
  name: "providers",
  priority: 1,
  load: loadProvidersConfig,
};
