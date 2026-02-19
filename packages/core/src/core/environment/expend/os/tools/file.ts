/**
 * @fileoverview File operation tools
 * Includes cross-platform compatibility for Windows, macOS, and Linux
 */

import { z } from "zod";
import type { ToolInfo, ToolResultMetadata } from "../../../../types/index.js";
import { glob as globModule } from "glob";
import { readFileSync, existsSync, readdirSync } from "fs";
import { normalizePath, isAbsolute, resolvePath } from "./filesystem.js";

const DEFAULT_READ_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_BYTES = 50 * 1024;

export interface ReadFileOptions {
  encoding?: BufferEncoding;
  maxSize?: number;
  offset?: number;
  limit?: number;
}

export async function readFile(
  path: string,
  options?: ReadFileOptions,
): Promise<string> {
  const fs = await import("fs/promises");
  const pathModule = await import("path");
  const encoding = options?.encoding ?? "utf-8";
  const maxSize = options?.maxSize ?? 1024 * 1024;

  const normalizedPath = normalizePath(path);

  const stat = await fs.stat(normalizedPath);
  if (stat.size > maxSize) {
    throw new Error(`File too large: ${stat.size} bytes (max: ${maxSize})`);
  }

  return fs.readFile(normalizedPath, { encoding });
}

/**
 * Read a file with pagination support and formatting.
 * Similar to OpenCode's read tool with line numbers and truncation.
 */
export async function readFileFormatted(
  path: string,
  options?: ReadFileOptions,
): Promise<{ content: string; metadata: { totalLines: number; truncated: boolean; truncatedByBytes?: boolean } }> {
  const fs = await import("fs/promises");
  const pathModule = await import("path");

  const normalizedPath = normalizePath(path);
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? DEFAULT_READ_LIMIT;

  const content = await fs.readFile(normalizedPath, { encoding: "utf-8" });
  const lines = content.split("\n");

  const raw: string[] = [];
  let bytes = 0;
  let truncatedByBytes = false;

  for (let i = offset; i < Math.min(lines.length, offset + limit); i++) {
    const line = lines[i].length > MAX_LINE_LENGTH ? lines[i].substring(0, MAX_LINE_LENGTH) + "..." : lines[i];
    const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0);
    if (bytes + size > MAX_BYTES) {
      truncatedByBytes = true;
      break;
    }
    raw.push(line);
    bytes += size;
  }

  const numberedLines = raw.map((line, index) => {
    const lineNum = (index + offset + 1).toString().padStart(5, "0");
    return `${lineNum}| ${line}`;
  });

  const totalLines = lines.length;
  const lastReadLine = offset + raw.length;
  const hasMoreLines = totalLines > lastReadLine;
  const truncated = hasMoreLines || truncatedByBytes;

  let output = "<file>\n";
  output += numberedLines.join("\n");

  if (truncatedByBytes) {
    output += `\n\n(Output truncated at ${MAX_BYTES} bytes. Use 'offset' parameter to read beyond line ${lastReadLine})`;
  } else if (hasMoreLines) {
    output += `\n\n(File has more lines. Use 'offset' parameter to read beyond line ${lastReadLine})`;
  } else {
    output += `\n\n(End of file - total ${totalLines} lines)`;
  }
  output += "\n</file>";

  return {
    content: output,
    metadata: { totalLines, truncated, truncatedByBytes },
  };
}

/**
 * Check if a file is binary.
 * Based on extension and content analysis.
 */
export async function isBinaryFile(filepath: string): Promise<boolean> {
  const ext = filepath.split(".").pop()?.toLowerCase() ?? "";

  const binaryExtensions = [
    "zip", "tar", "gz", "exe", "dll", "so", "class", "jar", "war",
    "7z", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "odt", "ods", "odp", "bin", "dat", "obj", "o", "a", "lib",
    "wasm", "pyc", "pyo", "db", "sqlite", "db3",
  ];

  if (binaryExtensions.includes(ext)) {
    return true;
  }

  try {
    const buffer = readFileSync(filepath);
    if (buffer.length === 0) return false;

    const checkLength = Math.min(4096, buffer.length);
    let nonPrintableCount = 0;

    for (let i = 0; i < checkLength; i++) {
      if (buffer[i] === 0) return true;
      if (buffer[i] < 9 || (buffer[i] > 13 && buffer[i] < 32)) {
        nonPrintableCount++;
      }
    }

    return nonPrintableCount / checkLength > 0.3;
  } catch {
    return false;
  }
}

/**
 * Find similar files when a file is not found.
 */
export function findSimilarFiles(filepath: string): string[] {
  try {
    const dir = filepath.split("/").slice(0, -1).join("/");
    const base = filepath.split("/").pop() ?? "";

    if (!existsSync(dir)) return [];

    const entries = readdirSync(dir);
    return entries
      .filter(
        (entry) =>
          entry.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(entry.toLowerCase()),
      )
      .map((entry) => `${dir}/${entry}`)
      .slice(0, 3);
  } catch {
    return [];
  }
}

export interface WriteFileOptions {
  encoding?: BufferEncoding;
  append?: boolean;
  createDirectories?: boolean;
  diff?: boolean;
}

export async function writeFile(
  path: string,
  content: string,
  options?: WriteFileOptions,
): Promise<{ success: boolean; output: string; diff?: string }> {
  const fs = await import("fs/promises");
  const pathModule = await import("path");
  const encoding = options?.encoding ?? "utf-8";

  const normalizedPath = normalizePath(path);

  let diff: string | undefined;

  if (options?.diff) {
    try {
      const existing = await fs.readFile(normalizedPath, { encoding: "utf-8" }).catch(() => "");
      if (existing) {
        diff = computeDiff(existing, content);
      }
    } catch {
      // File doesn't exist yet, no diff
    }
  }

  if (options?.createDirectories) {
    const dir = pathModule.dirname(normalizedPath);
    await fs.mkdir(dir, { recursive: true });
  }

  if (options?.append) {
    await fs.appendFile(normalizedPath, content, encoding);
  } else {
    await fs.writeFile(normalizedPath, content, encoding);
  }

  return {
    success: true,
    output: `Wrote ${content.length} bytes to ${path}`,
    diff,
  };
}

/**
 * Simple line-based diff computation.
 */
export function computeDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const diffLines: string[] = [];

  const maxLines = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === newLine) {
      diffLines.push(`  ${newLine ?? ""}`);
    } else {
      if (oldLine !== undefined) {
        diffLines.push(`- ${oldLine}`);
      }
      if (newLine !== undefined) {
        diffLines.push(`+ ${newLine}`);
      }
    }
  }

  return diffLines.join("\n");
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
        // Normalize paths for cross-platform compatibility
        results.add(normalizePath(match));
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
              file: normalizePath(path.relative(cwd, file)),
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
  const createMetadata = (extra?: Record<string, unknown>): ToolResultMetadata => ({
    execution_time_ms: Date.now(),
    ...extra,
  });

  const readFileDescription = `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The filePath parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.
- You can read image files using this tool.`;

  const grepDescription = `- Fast content search tool that works with any codebase size
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)
- Filter files by pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with at least one match sorted by modification time
- Use this tool when you need to find files containing specific patterns
- If you need to identify/count the number of matches within files, use the Bash tool with \`rg\` (ripgrep) directly. Do NOT use \`grep\`.
- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead`;

  const globDescription = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open-ended search that may require multiple rounds of globbing and grepping, use the Task tool instead
- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.`;

  const writeFileDescription = `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`;

  return [
    {
      name: "read_file",
      description: readFileDescription,
      parameters: z.object({
        path: z.string().describe("The path to the file to read"),
        offset: z.coerce.number().describe("The line number to start reading from (0-based)").optional(),
        limit: z.coerce.number().describe("The number of lines to read (defaults to 2000)").optional(),
      }),
      execute: async (args) => {
        try {
          let path = String(args.path ?? "");
          if (!path) {
            return {
              success: false,
              output: "",
              error: "Missing required parameter: path",
              metadata: createMetadata(),
            };
          }

          path = normalizePath(path);
          const absolutePath = isAbsolute(path) ? path : resolvePath(path);

          const { stat } = await import("fs/promises");

          try {
            const fileStat = await stat(absolutePath);
            if (fileStat.size > (1024 * 1024)) {
              return {
                success: false,
                output: "",
                error: `File too large: ${fileStat.size} bytes (max: 1MB)`,
                metadata: createMetadata({ output_size: fileStat.size }),
              };
            }
          } catch {
            const suggestions = findSimilarFiles(absolutePath);
            if (suggestions.length > 0) {
              return {
                success: false,
                output: "",
                error: `File not found: ${path}\n\nDid you mean one of these?\n${suggestions.join("\n")}`,
                metadata: createMetadata({ suggestions }),
              };
            }
            return {
              success: false,
              output: "",
              error: `File not found: ${path}`,
              metadata: createMetadata(),
            };
          }

          const isBinary = await isBinaryFile(absolutePath);
          if (isBinary) {
            return {
              success: false,
              output: "",
              error: `Cannot read binary file: ${path}`,
              metadata: createMetadata({ is_binary: true }),
            };
          }

          if (args.offset !== undefined || args.limit !== undefined) {
            const result = await readFileFormatted(absolutePath, {
              offset: args.offset,
              limit: args.limit,
            });
            return {
              success: true,
              output: result.content,
              metadata: createMetadata({
                total_lines: result.metadata.totalLines,
                truncated: result.metadata.truncated,
                truncated_by_bytes: result.metadata.truncatedByBytes,
              }),
            };
          }

          const content = await readFile(absolutePath, {
            encoding: (args.encoding as BufferEncoding) ?? "utf-8",
          });
          return {
            success: true,
            output: content,
            metadata: createMetadata({ output_size: content.length }),
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            error: `Failed to read file: ${(error as Error).message}`,
            metadata: createMetadata({ error: (error as Error).message }),
          };
        }
      },
    },
    {
      name: "write_file",
      description: writeFileDescription,
      parameters: z.object({
        path: z.string().describe("The path to the file to write"),
        content: z.string().describe("The content to write to the file"),
        append: z.boolean().optional().describe("Append to file instead of overwrite"),
        createDirs: z.boolean().optional().describe("Create parent directories if they don't exist"),
        showDiff: z.boolean().optional().describe("Show diff when overwriting existing file"),
      }),
      execute: async (args) => {
        try {
          let path = args.path;
          const content = args.content;

          if (!path || typeof path !== "string" || !path.trim()) {
            return {
              success: false,
              output: "",
              error: `Missing required parameter: 'path' (string). The write_file tool requires a file path to write to. Example: {"path": "agent-intro.md", "content": "# Agent Introduction\n..."}`,
              metadata: createMetadata(),
            };
          }

          if (!content || typeof content !== "string") {
            return {
              success: false,
              output: "",
              error: `Missing required parameter: 'content' (string). The write_file tool requires content to write.`,
              metadata: createMetadata(),
            };
          }

          path = normalizePath(path);
          const absolutePath = isAbsolute(path) ? path : resolvePath(path);

          const result = await writeFile(absolutePath, content, {
            append: args.append,
            createDirectories: args.createDirs,
            diff: args.showDiff,
          });

          let output = result.output;
          if (result.diff) {
            output += `\n\n${result.diff}`;
          }

          return {
            success: true,
            output,
            metadata: createMetadata({
              output_size: content.length,
              file_path: absolutePath,
            }),
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            error: `Failed to write file: ${(error as Error).message}`,
            metadata: createMetadata({ error: (error as Error).message }),
          };
        }
      },
    },
    {
      name: "glob",
      description: globDescription,
      parameters: z.object({
        pattern: z.string().describe("The glob pattern to match files against"),
        path: z.string().optional().describe("The directory to search in. If not specified, the current working directory will be used."),
        maxResults: z.number().optional().describe("Maximum results to return (default: 100)"),
      }),
      execute: async (args) => {
        try {
          const results = await glob(args.pattern, {
            cwd: args.path,
            maxResults: args.maxResults ?? 100,
          });
          return {
            success: true,
            output: results.join("\n"),
            metadata: createMetadata({
              result_count: results.length,
            }),
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            error: `Failed to glob: ${(error as Error).message}`,
            metadata: createMetadata({ error: (error as Error).message }),
          };
        }
      },
    },
    {
      name: "grep",
      description: grepDescription,
      parameters: z.object({
        pattern: z.string().describe("The regex pattern to search for in file contents"),
        path: z.string().optional().describe("The directory to search in. Defaults to the current working directory."),
        include: z.string().optional().describe('File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")'),
        maxMatches: z.number().optional().describe("Maximum matches to return (default: 100)"),
      }),
      execute: async (args) => {
        try {
          if (!args.pattern) {
            return {
              success: false,
              output: "",
              error: "Missing required parameter: pattern",
              metadata: createMetadata(),
            };
          }

          const results = await grep(args.pattern, {
            cwd: args.path,
            maxMatches: args.maxMatches ?? 100,
            includePatterns: args.include ? [args.include] : undefined,
          });

          const output = results
            .map((r) => `${r.file}:${r.line}: ${r.content}`)
            .join("\n");

          return {
            success: true,
            output,
            metadata: createMetadata({
              match_count: results.length,
            }),
          };
        } catch (error) {
          return {
            success: false,
            output: "",
            error: `Failed to grep: ${(error as Error).message}`,
            metadata: createMetadata({ error: (error as Error).message }),
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
