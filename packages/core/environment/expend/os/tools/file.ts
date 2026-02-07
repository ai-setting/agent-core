/**
 * @fileoverview File operation tools
 */

import { z } from "zod";
import type { ToolInfo } from "../../../../types/index.js";
import { glob as globModule } from "glob";

export interface ReadFileOptions {
  encoding?: BufferEncoding;
  maxSize?: number;
}

export async function readFile(
  path: string,
  options?: ReadFileOptions,
): Promise<string> {
  const fs = await import("fs/promises");
  const encoding = options?.encoding ?? "utf-8";
  const maxSize = options?.maxSize ?? 1024 * 1024;

  const stat = await fs.stat(path);
  if (stat.size > maxSize) {
    throw new Error(`File too large: ${stat.size} bytes (max: ${maxSize})`);
  }

  return fs.readFile(path, { encoding });
}

export interface WriteFileOptions {
  encoding?: BufferEncoding;
  append?: boolean;
  createDirectories?: boolean;
}

export async function writeFile(
  path: string,
  content: string,
  options?: WriteFileOptions,
): Promise<void> {
  const fs = await import("fs/promises");
  const pathModule = await import("path");
  const encoding = options?.encoding ?? "utf-8";

  if (options?.createDirectories) {
    const dir = pathModule.dirname(path);
    await fs.mkdir(dir, { recursive: true });
  }

  if (options?.append) {
    await fs.appendFile(path, content, encoding);
  } else {
    await fs.writeFile(path, content, encoding);
  }
}

export interface GlobOptions {
  cwd?: string;
  pattern?: string;
  maxResults?: number;
}

export async function glob(
  patterns: string | string[],
  options?: GlobOptions,
): Promise<string[]> {
  const cwd = options?.cwd ?? process.cwd();
  const maxResults = options?.maxResults ?? 1000;

  const patternArray = Array.isArray(patterns) ? patterns : [patterns];
  const results: Set<string> = new Set();

  for (const pattern of patternArray) {
    const matches = globModule.sync(pattern, {
      cwd,
      absolute: true,
      nodir: true,
      ignore: ["node_modules/**", ".git/**"],
    });

    for (const match of matches) {
      if (results.size < maxResults) {
        results.add(match);
      }
    }
  }

  return Array.from(results).slice(0, maxResults);
}

export interface GrepOptions {
  cwd?: string;
  pattern?: string;
  maxMatches?: number;
  caseSensitive?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
}

export async function grep(
  patterns: string | RegExp | (string | RegExp)[],
  options?: GrepOptions,
): Promise<Array<{ file: string; line: number; content: string }>> {
  const path = await import("path");

  const cwd = options?.cwd ?? process.cwd();
  const maxMatches = options?.maxMatches ?? 100;
  const caseSensitive = options?.caseSensitive ?? true;

  const searchRegexes = (Array.isArray(patterns) ? patterns : [patterns]).map((p) =>
    p instanceof RegExp ? p : new RegExp(p, caseSensitive ? "g" : "gi"),
  );

  const results: Array<{ file: string; line: number; content: string }> = [];

  const files = await glob(options?.includePatterns ?? ["**/*"], {
    cwd,
    maxResults: 500,
  });

  for (const file of files) {
    if (results.length >= maxMatches) break;

    const skipFile = options?.excludePatterns?.some((pattern) => {
      const regex = new RegExp(pattern);
      return regex.test(file);
    });

    if (skipFile) continue;

    try {
      const content = await readFile(file, { maxSize: 1024 * 1024 });
      const lines = content.split("\n");

      for (let i = 0; i < lines.length && results.length < maxMatches; i++) {
        const line = lines[i];

        for (const regex of searchRegexes) {
          regex.lastIndex = 0;
          if (regex.test(line)) {
            results.push({
              file: path.relative(cwd, file),
              line: i + 1,
              content: line.trim(),
            });
            break;
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}

export function createFileTools(): ToolInfo[] {
  return [
    {
      name: "read_file",
      description: "Read the contents of a file",
      parameters: z.object({
        path: z.string().describe("Path to the file to read"),
        encoding: z.string().optional().describe("File encoding (default: utf-8)"),
      }),
      execute: async (args) => {
        try {
          const path = String(args.path ?? "");
          if (!path) {
            return {
              success: false,
              output: "",
              error: "Missing required parameter: path",
            };
          }
          const content = await readFile(path, {
            encoding: (args.encoding as BufferEncoding) ?? "utf-8",
          });
          return {
            success: true,
            output: content,
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            error: `Failed to read file: ${(error as Error).message}`,
          };
        }
      },
    },
    {
      name: "write_file",
      description: "Write content to a file",
      parameters: z.object({
        path: z.string().describe("Path to the file to write"),
        content: z.string().describe("Content to write to the file"),
        append: z.boolean().optional().describe("Append to file instead of overwrite"),
        createDirs: z.boolean().optional().describe("Create parent directories if they don't exist"),
      }),
      execute: async (args) => {
        try {
          const path = args.path;
          const content = args.content;
          
          if (!path || typeof path !== "string" || !path.trim()) {
            return {
              success: false,
              output: "",
              error: `Missing required parameter: 'path' (string). The write_file tool requires a file path to write to. Example: {"path": "agent-intro.md", "content": "# Agent Introduction\n..."}`,
            };
          }
          
          if (!content || typeof content !== "string") {
            return {
              success: false,
              output: "",
              error: `Missing required parameter: 'content' (string). The write_file tool requires content to write.`,
            };
          }
          
          await writeFile(path, content, {
            append: args.append,
            createDirectories: args.createDirs,
          });
          return {
            success: true,
            output: `Wrote ${content.length} bytes to ${path}`,
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            error: `Failed to write file: ${(error as Error).message}`,
          };
        }
      },
    },
    {
      name: "glob",
      description: "Find files matching a glob pattern",
      parameters: z.object({
        patterns: z.union([z.string(), z.array(z.string())]).describe("Glob patterns"),
        cwd: z.string().optional().describe("Working directory to search in"),
        maxResults: z.number().optional().describe("Maximum results (default: 100)"),
      }),
      execute: async (args) => {
        try {
          const results = await glob(args.patterns, {
            cwd: args.cwd,
            maxResults: args.maxResults ?? 100,
          });
          return {
            success: true,
            output: results.join("\n"),
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            error: `Failed to glob: ${(error as Error).message}`,
          };
        }
      },
    },
    {
      name: "grep",
      description: "Search for text patterns in files",
      parameters: z.object({
        patterns: z.union([z.string(), z.array(z.string())]).describe("Search patterns"),
        cwd: z.string().optional().describe("Working directory to search in"),
        maxMatches: z.number().optional().describe("Maximum matches (default: 100)"),
        caseSensitive: z.boolean().optional().describe("Case sensitive search (default: true)"),
        include: z.array(z.string()).optional().describe("File patterns to include"),
        exclude: z.array(z.string()).optional().describe("File patterns to exclude"),
      }),
      execute: async (args) => {
        try {
          const results = await grep(args.patterns, {
            cwd: args.cwd,
            maxMatches: args.maxMatches ?? 100,
            caseSensitive: args.caseSensitive,
            includePatterns: args.include,
            excludePatterns: args.exclude,
          });

          const output = results
            .map((r) => `${r.file}:${r.line}: ${r.content}`)
            .join("\n");

          return {
            success: true,
            output,
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            error: `Failed to grep: ${(error as Error).message}`,
          };
        }
      },
    },
  ];
}

export function createOsTools(): ToolInfo[] {
  const { createBashTool } = require("./bash.js");
  return [createBashTool(), ...createFileTools()];
}
