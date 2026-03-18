/**
 * @fileoverview Memory Command
 *
 * tong_work memory 命令 - 管理 memory 文件
 */

import { CommandModule } from "yargs";
import path from "path";
import os from "os";
import fs from "fs/promises";
import { Config_get } from "../../config/index.js";
import { ConfigPaths } from "../../config/paths.js";
import {
  listMemoryFileImpl,
  readMemoryFileImpl,
  writeMemoryFileImpl,
  grepMemoryFileImpl,
} from "../../server/built-in-memory-tools.js";

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
 */
async function getMemoryPaths(): Promise<{ path: string; type: string; exists: boolean }[]> {
  const paths: { path: string; type: string; exists: boolean }[] = [];

  try {
    const config = await Config_get();
    const memoryConfig = config.memory as any;

    if (memoryConfig) {
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
    console.warn("[Memory] Failed to load config:", e);
  }

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

interface MemoryOptions {
  type: "help" | "paths" | "list" | "read" | "write" | "grep";
  dir?: string;
  filename?: string;
  content?: string;
  pattern?: string;
}

const memoryCommand: CommandModule<object, MemoryOptions> = {
  command: "memory",
  describe: "Manage memory files (list, read, write, search, grep)",
  builder: (yargs) =>
    yargs.options({
      type: {
        describe: "Action type: help, paths, list, read, write, grep",
        choices: ["help", "paths", "list", "read", "write", "grep"],
        default: "help",
      },
      dir: {
        describe: "Directory path (relative to memory root)",
        type: "string",
      },
      filename: {
        describe: "File name",
        type: "string",
      },
      content: {
        describe: "File content (for write)",
        type: "string",
      },
      pattern: {
        describe: "Search pattern (for grep)",
        type: "string",
      },
    }),

  async handler(argv) {
    const opts = argv as MemoryOptions;

    switch (opts.type) {
      case "help":
        console.log(`
Memory Command Help
=================

Usage: tong_work memory [options]

Options:
  --type          Action type: help, paths, list, read, write
  --dir           Directory path (relative to memory root)
  --filename      File name
  --content       File content (for write)

Examples:
  tong_work memory --type paths
  tong_work memory --type list
  tong_work memory --type list --dir operations
  tong_work memory --type read --dir operations --filename test.md
  tong_work memory --type write --dir solutions --filename fix.md --content "# Solution"
`);
        break;

      case "paths": {
        const paths = await getMemoryPaths();
        console.log("Memory paths:");
        for (const p of paths) {
          console.log(`  [${p.type}] ${p.path} ${p.exists ? "(exists)" : "(not exists)"}`);
        }
        break;
      }

      case "list": {
        const result = await listMemoryFileImpl({ dir: opts.dir });
        if (!result.success) {
          console.error(`Error: ${result.error}`);
          process.exit(1);
        }
        const output = result.output as Record<string, string[]>;
        for (const [basePath, files] of Object.entries(output)) {
          console.log(`\n[${basePath}]:`);
          for (const f of files) {
            console.log(`  ${f}`);
          }
        }
        break;
      }

      case "read": {
        if (!opts.filename) {
          console.error("Error: --filename is required for read");
          process.exit(1);
        }
        const result = await readMemoryFileImpl({ dir: opts.dir || "", filename: opts.filename });
        if (!result.success) {
          console.error(`Error: ${result.error}`);
          process.exit(1);
        }
        const output = result.output as { content: string; path: string };
        console.log(`\n[${output.path}]:\n${output.content}`);
        break;
      }

      case "write": {
        if (!opts.filename || !opts.content) {
          console.error("Error: --filename and --content are required for write");
          process.exit(1);
        }
        const result = await writeMemoryFileImpl({
          dir: opts.dir,
          filename: opts.filename,
          content: opts.content,
        });
        if (!result.success) {
          console.error(`Error: ${result.error}`);
          process.exit(1);
        }
        const output = result.output as { success: boolean; path: string };
        console.log(`Written: ${output.path}`);
        break;
      }

      case "grep": {
        if (!opts.pattern) {
          console.error("Error: --pattern is required for grep");
          process.exit(1);
        }
        const result = await grepMemoryFileImpl({ pattern: opts.pattern, dir: opts.dir });
        if (!result.success) {
          console.error(`Error: ${result.error}`);
          process.exit(1);
        }
        const output = result.output as { results: Array<{ file: string; matches: string[] }> };
        const results = output.results;
        if (results.length === 0) {
          console.log(`No matches found for: ${opts.pattern}`);
        } else {
          console.log(`\nSearch results for "${opts.pattern}":`);
          for (const r of results) {
            console.log(`\n[${r.file}]:`);
            for (const m of r.matches.slice(0, 5)) {
              console.log(`  ${m}`);
            }
            if (r.matches.length > 5) {
              console.log(`  ... and ${r.matches.length - 5} more matches`);
            }
          }
        }
        break;
      }
    }
  },
};

export default memoryCommand;
