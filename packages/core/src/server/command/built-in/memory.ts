/**
 * @fileoverview Memory Command - Memory management
 *
 * Manages memory listing, reading, writing, and searching
 */

import type { Command, CommandContext, CommandResult } from "../types.js";
import { serverLogger } from "../../logger.js";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { Config_get } from "../../../config/index.js";
import { ConfigPaths } from "../../../config/paths.js";

/**
 * Expand ~ to home directory
 */
function expandUser(filePath: string): string {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

interface MemoryAction {
  type: "list" | "read" | "write" | "paths" | "help";
  dir?: string;
  filename?: string;
  content?: string;
  pattern?: string;
}

interface MemoryPathInfo {
  path: string;
  type: "project" | "environment" | "global";
  exists: boolean;
}

/**
 * 获取所有配置的 memory 路径
 */
async function getMemoryPaths(): Promise<MemoryPathInfo[]> {
  const paths: MemoryPathInfo[] = [];
  
  try {
    const config = await Config_get();
    const memoryConfig = config.memory;

    if (memoryConfig) {
      // 添加配置的 paths
      if (memoryConfig.paths) {
        for (const p of memoryConfig.paths) {
          try {
            await fs.access(p);
            paths.push({ path: p, type: "project", exists: true });
          } catch {
            paths.push({ path: p, type: "project", exists: false });
          }
        }
      }

      // 添加全局路径
      if (memoryConfig.globalPath) {
        const globalPath = expandUser(memoryConfig.globalPath);
        try {
          await fs.access(globalPath);
          paths.push({ path: globalPath, type: "global", exists: true });
        } catch {
          paths.push({ path: globalPath, type: "global", exists: false });
        }
      }
    }
  } catch (e) {
    serverLogger.warn("[Memory] Failed to load config:", e);
  }

  // 如果没有配置，使用默认 XDG 路径
  if (paths.length === 0) {
    const defaultPath = path.join(ConfigPaths.data, "memory");
    try {
      await fs.access(defaultPath);
      paths.push({ path: defaultPath, type: "global", exists: true });
    } catch {
      paths.push({ path: defaultPath, type: "global", exists: false });
    }
  }

  return paths;
}

/**
 * Memory Command - Manage memory files
 */
export const memoryCommand: Command = {
  name: "memory",
  displayName: "Memory",
  description: "Manage memory files (list, read, write, search)",
  hasArgs: true,
  argsDescription: '{"type":"list"|"type":"paths"|"type":"read","dir":"...","filename":"..."|"type":"write","dir":"...","filename":"...","content":"..."|"type":"search","pattern":"..."}',

  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    // Parse action
    let action: MemoryAction;
    try {
      action = args ? JSON.parse(args) : { type: "help" };
    } catch {
      return {
        success: false,
        message: "Invalid arguments",
        data: { error: "Invalid JSON. Use {\"type\":\"help\"} for help." },
      };
    }

    switch (action.type) {
      case "help":
        return handleHelpAction();

      case "paths":
        return await handlePathsAction();

      case "list":
        return await handleListAction(action.dir);

      case "read":
        return await handleReadAction(action.dir, action.filename);

      case "write":
        return await handleWriteAction(action.dir, action.filename, action.content);

      default:
        return {
          success: false,
          message: `Unknown action: ${(action as MemoryAction).type}`,
        };
    }
  },
};

function handleHelpAction(): CommandResult {
  return {
    success: true,
    message: "Memory Command Help",
    data: {
      help: {
        description: "Manage memory files",
        usage: 'tong_work memory \'{"type":"..."}\'',
        actions: {
          paths: "List all configured memory paths",
          list: 'List memory files. Usage: {"type":"list","dir":"operations"}',
          read: 'Read a memory file. Usage: {"type":"read","dir":"operations","filename":"test.md"}',
          write: 'Write a memory file. Usage: {"type":"write","dir":"operations","filename":"test.md","content":"# content"}',
        },
        examples: [
          'tong_work memory \'{"type":"paths"}\'',
          'tong_work memory \'{"type":"list"}\'',
          'tong_work memory \'{"type":"list","dir":"operations"}\'',
          'tong_work memory \'{"type":"read","dir":"operations","filename":"task_123.md"}\'',
          'tong_work memory \'{"type":"write","dir":"solutions","filename":"fix_bug.md","content":"# Solution\\n\\nStep by step..."}\'',
        ],
      },
    },
  };
}

async function handlePathsAction(): Promise<CommandResult> {
  const paths = await getMemoryPaths();
  return {
    success: true,
    message: "Memory paths",
    data: { paths },
  };
}

async function handleListAction(dir?: string): Promise<CommandResult> {
  const paths = await getMemoryPaths();
  const results: Record<string, string[]> = {};

  for (const pathInfo of paths) {
    if (!pathInfo.exists) continue;

    const targetPath = dir ? path.join(pathInfo.path, dir) : pathInfo.path;

    try {
      const entries = await fs.readdir(targetPath, { withFileTypes: true });
      const files: string[] = [];
      const dirs: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push(entry.name + "/");
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          files.push(entry.name);
        }
      }

      results[pathInfo.path] = [...dirs, ...files];
    } catch {
      // Directory doesn't exist
    }
  }

  return {
    success: true,
    message: "Memory files",
    data: { dir, files: results },
  };
}

async function handleReadAction(dir?: string, filename?: string): Promise<CommandResult> {
  if (!filename) {
    return {
      success: false,
      message: "filename is required for read action",
      data: { error: "Missing filename" },
    };
  }

  const paths = await getMemoryPaths();
  const targetDir = dir || "";

  for (const pathInfo of paths) {
    if (!pathInfo.exists) continue;

    const filePath = path.join(pathInfo.path, targetDir, filename);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      return {
        success: true,
        message: `Read file: ${filename}`,
        data: { content, path: filePath },
      };
    } catch {
      // File doesn't exist in this path, continue
    }
  }

  return {
    success: false,
    message: `File not found: ${targetDir}/${filename}`,
    data: { error: "File not found" },
  };
}

async function handleWriteAction(
  dir: string | undefined,
  filename: string | undefined,
  content: string | undefined
): Promise<CommandResult> {
  if (!filename || !content) {
    return {
      success: false,
      message: "filename and content are required for write action",
      data: { error: "Missing filename or content" },
    };
  }

  const paths = await getMemoryPaths();

  if (paths.length === 0) {
    return {
      success: false,
      message: "No memory paths configured",
      data: { error: "No memory paths" },
    };
  }

  // Write to first available path
  const pathInfo = paths[0];
  const targetDir = dir || "";
  const targetPath = path.join(pathInfo.path, targetDir);

  try {
    await fs.mkdir(targetPath, { recursive: true });
    const filePath = path.join(targetPath, filename);
    await fs.writeFile(filePath, content, "utf-8");

    return {
      success: true,
      message: `Written: ${filename}`,
      data: { path: filePath },
    };
  } catch (e) {
    return {
      success: false,
      message: `Failed to write file: ${e}`,
      data: { error: String(e) },
    };
  }
}
