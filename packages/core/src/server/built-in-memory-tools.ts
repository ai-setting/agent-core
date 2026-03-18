/**
 * @fileoverview Memory operation tools
 * Provides tools for reading, writing, and searching memory files
 */

import { z } from "zod";
import path from "path";
import fs from "fs/promises";
import os from "os";
import type { ToolInfo, ToolResult, ToolResultMetadata } from "../core/types/index.js";
import { Config_get } from "../config/index.js";
import { ConfigPaths } from "../config/paths.js";

/**
 * Expand ~ to home directory
 */
function expandUser(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * 获取所有配置的 memory 路径
 * 优先从配置获取，其次使用默认值
 */
async function getMemoryPaths(): Promise<string[]> {
  const paths: string[] = [];

  // 尝试从配置获取
  try {
    const config = await Config_get();
    const memoryConfig = (config as any).memory;

    if (memoryConfig) {
      // 添加配置的 paths
      if (memoryConfig.paths) {
        for (const p of memoryConfig.paths) {
          paths.push(p);
        }
      }

      // 添加全局路径
      if (memoryConfig.globalPath) {
        paths.push(expandUser(memoryConfig.globalPath));
      }
    }
  } catch (e) {
    console.warn("[Memory] Failed to load config, using defaults:", e);
  }

  // 如果没有配置，使用默认 XDG 路径
  if (paths.length === 0) {
    const defaultPath = path.join(ConfigPaths.data, "memory");
    paths.push(defaultPath);
  }

  return paths;
}

/**
 * 查找文件所在的 memory 路径
 */
async function findFileInPaths(
  paths: string[],
  dir: string,
  filename: string
): Promise<string | null> {
  for (const basePath of paths) {
    const fullPath = path.join(basePath, dir, filename);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // 文件不在这个路径，继续查找
    }
  }
  return null;
}

/**
 * Create metadata for tool results
 */
function createMetadata(extra?: Record<string, unknown>): ToolResultMetadata {
  return {
    execution_time_ms: Date.now(),
    ...extra,
  };
}

// ==================== Tool Implementations ====================

/**
 * List memory files in the memory directory
 */
async function listMemoryFileImpl(args: { dir?: string }): Promise<ToolResult> {
  try {
    const paths = await getMemoryPaths();
    const results: Record<string, string[]> = {};

    for (const basePath of paths) {
      const targetPath = args.dir
        ? path.join(basePath, args.dir)
        : basePath;

      try {
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        const files: string[] = [];
        const dirs: string[] = [];

        for (const entry of entries) {
          if (entry.isDirectory()) {
            dirs.push(entry.name);
          } else if (entry.isFile() && entry.name.endsWith(".md")) {
            files.push(entry.name);
          }
        }

        results[basePath] = [
          ...dirs.map(d => `${d}/`),
          ...files
        ];
      } catch {
        // 目录不存在，跳过
      }
    }

    return {
      success: true,
      output: results,
      metadata: createMetadata(),
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: `Failed to list memory files: ${(error as Error).message}`,
      metadata: createMetadata(),
    };
  }
}

/**
 * Read a memory file
 */
async function readMemoryFileImpl(args: { dir: string; filename: string }): Promise<ToolResult> {
  try {
    const paths = await getMemoryPaths();
    const filePath = await findFileInPaths(paths, args.dir, args.filename);

    if (!filePath) {
      return {
        success: false,
        output: "",
        error: `文件不存在: ${args.dir}/${args.filename}`,
        metadata: createMetadata(),
      };
    }

    const content = await fs.readFile(filePath, "utf-8");
    return {
      success: true,
      output: { content, path: filePath },
      metadata: createMetadata({ output_size: content.length }),
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: `Failed to read memory file: ${(error as Error).message}`,
      metadata: createMetadata(),
    };
  }
}

/**
 * Write a memory file
 */
async function writeMemoryFileImpl(args: { dir?: string; filename: string; content: string }): Promise<ToolResult> {
  try {
    const paths = await getMemoryPaths();

    if (paths.length === 0) {
      return {
        success: false,
        output: "",
        error: "未配置 memory 路径",
        metadata: createMetadata(),
      };
    }

    // 优先写入第一个路径
    const basePath = paths[0];
    const targetDir = args.dir || "";
    const targetPath = path.join(basePath, targetDir);

    // 确保目录存在
    await fs.mkdir(targetPath, { recursive: true });

    // 写入文件
    const filePath = path.join(targetPath, args.filename);
    await fs.writeFile(filePath, args.content, "utf-8");

    return {
      success: true,
      output: { success: true, path: filePath },
      metadata: createMetadata({ output_size: args.content.length }),
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: `Failed to write memory file: ${(error as Error).message}`,
      metadata: createMetadata(),
    };
  }
}

/**
 * 递归搜索目录中的 .md 文件
 */
async function searchDirectory(
  dirPath: string,
  basePath: string,
  pattern: string,
  depth: number,
  currentDepth: number = 0
): Promise<Array<{ file: string; matches: string[] }>> {
  const results: Array<{ file: string; matches: string[] }> = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isFile() && entry.name.endsWith(".md")) {
        // 搜索文件内容
        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        const matches: string[] = [];

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(pattern.toLowerCase())) {
            matches.push(`${i + 1}: ${lines[i]}`);
          }
        }

        if (matches.length > 0) {
          results.push({
            file: path.relative(basePath, fullPath),
            matches,
          });
        }
      } else if (entry.isDirectory() && currentDepth < depth) {
        // 递归搜索子目录
        const subResults = await searchDirectory(
          fullPath,
          basePath,
          pattern,
          depth,
          currentDepth + 1
        );
        results.push(...subResults);
      }
    }
  } catch {
    // 目录不存在，跳过
  }

  return results;
}

/**
 * Search for a pattern in memory files
 */
async function grepMemoryFileImpl(args: { pattern: string; dir?: string; depth?: number }): Promise<ToolResult> {
  try {
    const paths = await getMemoryPaths();
    const depth = args.depth ?? 3; // 默认搜索 3 层

    for (const basePath of paths) {
      const targetPath = args.dir
        ? path.join(basePath, args.dir)
        : basePath;

      const results = await searchDirectory(targetPath, basePath, args.pattern, depth);

      return {
        success: true,
        output: { results } as Record<string, unknown>,
        metadata: createMetadata(),
      };
    }

    return {
      success: false,
      output: "",
      error: "No memory paths configured",
      metadata: createMetadata(),
    };
  } catch (error) {
    return {
      success: false,
      output: "",
      error: `Failed to grep memory files: ${(error as Error).message}`,
      metadata: createMetadata(),
    };
  }
}

// ==================== Tool Definitions ====================

const listMemoryFileDescription = `List memory files in the memory directory.

Usage:
- Lists all .md files in the configured memory paths
- Returns files organized by their base memory path
- Optional 'dir' parameter to filter by subdirectory`;

const readMemoryFileDescription = `Read a memory file from the memory directory.

Usage:
- Requires 'dir' (subdirectory) and 'filename' parameters
- Returns file content and path
- File must exist in one of the configured memory paths`;

const writeMemoryFileDescription = `Write content to a memory file.

Usage:
- Requires 'filename' and 'content' parameters
- Optional 'dir' parameter for subdirectory
- File will be created in the first configured memory path
- Filename should end with .md`;

const grepMemoryFileDescription = `Search for a pattern in memory files.

Usage:
- Requires 'pattern' parameter (search keyword)
- Optional 'dir' parameter to search in specific subdirectory
- Optional 'depth' parameter to limit search depth (default: 3)
- Returns file paths and matching lines
- Case-insensitive search`;

/**
 * Create memory tools - following the same pattern as file.ts tools
 */
export function createMemoryTools(): ToolInfo[] {
  return [
    {
      name: "list_memory_file",
      description: listMemoryFileDescription,
      parameters: z.object({
        dir: z.string().optional().describe("子目录路径（相对于 memory 根目录，可选）"),
      }),
      execute: async (args) => {
        return await listMemoryFileImpl(args as { dir?: string });
      },
    },
    {
      name: "read_memory_file",
      description: readMemoryFileDescription,
      parameters: z.object({
        dir: z.string().describe("子目录路径（相对于 memory 根目录）"),
        filename: z.string().describe("文件名"),
      }),
      execute: async (args) => {
        return await readMemoryFileImpl(args as { dir: string; filename: string });
      },
    },
    {
      name: "write_memory_file",
      description: writeMemoryFileDescription,
      parameters: z.object({
        dir: z.string().optional().describe("子目录路径（相对于 memory 根目录，可选）"),
        filename: z.string().describe("文件名（必须以 .md 结尾）"),
        content: z.string().describe("文件内容"),
      }),
      execute: async (args) => {
        return await writeMemoryFileImpl(args as { dir?: string; filename: string; content: string });
      },
    },
    {
      name: "grep_memory_file",
      description: grepMemoryFileDescription,
      parameters: z.object({
        pattern: z.string().describe("搜索关键词"),
        dir: z.string().optional().describe("子目录路径（相对于 memory 根目录，可选）"),
        depth: z.number().optional().describe("搜索深度层级（默认 3）"),
      }),
      execute: async (args) => {
        return await grepMemoryFileImpl(args as { pattern: string; dir?: string; depth?: number });
      },
    },
  ];
}

// 导出实现函数供 CLI 使用
export { listMemoryFileImpl, readMemoryFileImpl, writeMemoryFileImpl, grepMemoryFileImpl };
