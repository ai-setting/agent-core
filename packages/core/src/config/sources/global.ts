import path from "path";
import fs from "fs/promises";
import * as jsonc from "jsonc-parser";
import { ConfigPaths } from "../paths.js";
import type { ConfigSource } from "../source.js";
import type { Config } from "../types.js";

const CONFIG_FILENAMES = ["tong_work.jsonc", "tong_work.json"];

export async function loadGlobalConfig(): Promise<Config.Info | null> {
  for (const filename of CONFIG_FILENAMES) {
    const filepath = path.join(ConfigPaths.config, filename);
    try {
      const content = await fs.readFile(filepath, "utf-8");
      return parseConfigFile(content, filepath);
    } catch (error) {
      if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
        continue;
      }
      console.warn(`[Config] Failed to read global config "${filepath}":`, error);
    }
  }
  return null;
}

function parseConfigFile(content: string, filepath: string): Config.Info {
  if (filepath.endsWith(".jsonc")) {
    return parseJsonc(content, filepath);
  }
  return JSON.parse(content);
}

function parseJsonc(content: string, filepath: string): Config.Info {
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
  
  return result as Config.Info;
}

export const globalSource: ConfigSource = {
  name: "global",
  priority: 0,
  load: loadGlobalConfig,
};
