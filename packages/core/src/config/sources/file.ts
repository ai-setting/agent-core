import fs from "fs/promises";
import path from "path";
import * as jsonc from "jsonc-parser";
import type { ConfigSource } from "../source.js";
import type { Config } from "../types.js";

export async function loadFileConfig(filepath: string): Promise<Config.Info | null> {
  try {
    const content = await fs.readFile(filepath, "utf-8");
    const ext = path.extname(filepath);
    if (ext === ".jsonc") {
      return parseJsonc(content, filepath);
    }
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as { code: string }).code === "ENOENT") {
      return null;
    }
    console.warn(`[Config] Failed to read config file "${filepath}":`, error);
    return null;
  }
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

export function createFileSource(
  filepath: string,
  priority: number = 200
): ConfigSource {
  return {
    name: `file:${path.basename(filepath)}`,
    priority,
    load: () => loadFileConfig(filepath),
  };
}
