/**
 * @fileoverview Env Command - Environment management CLI
 *
 * Handles env subcommands: install, list, etc.
 */

import { CommandModule } from "yargs";
import fs from "fs/promises";
import path from "path";
import { ConfigPaths } from "../../config/paths.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse source path - handle file:// URI or absolute path
 */
function parseSourcePath(source: string): string {
  if (source.startsWith("file://")) {
    return source.replace("file://", "");
  }
  return source;
}

/**
 * Validate source folder has valid environment structure
 */
async function validateSourceFolder(sourcePath: string): Promise<{ valid: boolean; error?: string }> {
  // Check if path exists
  if (!(await pathExists(sourcePath))) {
    return { valid: false, error: `Source folder does not exist: ${sourcePath}` };
  }

  // Check if it's a directory
  const stat = await fs.stat(sourcePath);
  if (!stat.isDirectory()) {
    return { valid: false, error: `Source path is not a directory: ${sourcePath}` };
  }

  // Check for config.jsonc
  const configPath = path.join(sourcePath, "config.jsonc");
  if (!(await pathExists(configPath))) {
    return { valid: false, error: `Source folder is not a valid environment: missing config.jsonc` };
  }

  return { valid: true };
}

/**
 * Install environment from source folder to target
 */
async function handleInstall(args: any): Promise<void> {
  const { source, global, local, name, force } = args;

  // 1. Parse source path
  const sourcePath = parseSourcePath(source);

  console.log(`Installing environment from: ${sourcePath}`);

  // 2. Validate source folder
  const validation = await validateSourceFolder(sourcePath);
  if (!validation.valid) {
    console.error(`\n❌ Validation failed: ${validation.error}`);
    console.error(`\nEnvironment folder should contain:`);
    console.error(`  - config.jsonc (required)`);
    console.error(`  - skills/ (optional)`);
    console.error(`  - mcpservers/ (optional)`);
    console.error(`  - eventsources/ (optional)`);
    console.error(`  - prompts/ (optional)`);
    process.exit(1);
  }

  // 3. Determine target path
  const envName = name || path.basename(sourcePath);
  
  // Validate env name
  if (!/^[a-zA-Z0-9_-]+$/.test(envName)) {
    console.error(`\n❌ Invalid environment name: ${envName}`);
    console.error(`Use only letters, numbers, underscores, and hyphens.`);
    process.exit(1);
  }

  let targetDir: string;
  let targetType: string;

  if (global) {
    targetDir = path.join(ConfigPaths.environments, envName);
    targetType = "global";
  } else {
    targetDir = path.join(ConfigPaths.projectEnvironments, envName);
    targetType = "local";
  }

  console.log(`Target: ${targetType} (${targetDir})`);

  // 4. Check if target already exists
  if (await pathExists(targetDir)) {
    if (!force) {
      console.error(`\n❌ Environment "${envName}" already exists in ${targetType}`);
      console.error(`Use --force to overwrite existing environment`);
      process.exit(1);
    }
    console.log(`Overwriting existing environment...`);
    await fs.rm(targetDir, { recursive: true, force: true });
  }

  // 5. Ensure target parent directory exists
  const targetParent = path.dirname(targetDir);
  await fs.mkdir(targetParent, { recursive: true });

  // 6. Copy folder
  console.log(`Copying files...`);
  await fs.cp(sourcePath, targetDir, { recursive: true });

  console.log(`\n✅ Environment "${envName}" installed successfully!`);
  console.log(`   Location: ${targetDir}`);
  console.log(`\n📝 Note: If your environment uses MCP servers with relative paths,`);
  console.log(`   make sure the command paths are relative to the environment root.`);
  console.log(`   Example: "mcpservers/my-mcp/server.js" instead of "src/index.js"`);
  
  // 7. Prompt to switch
  console.log(`\nTo use this environment, run:`);
  console.log(`   tong_work env switch ${envName}`);
}

/**
 * List environments
 */
async function handleList(args: any): Promise<void> {
  const { global, local } = args;
  const showGlobal = global || (!local);
  const showLocal = local || (!global);

  console.log(`\n📋 Environments\n`);
  console.log(`Global: ${ConfigPaths.environments}`);
  console.log(`Local:  ${ConfigPaths.projectEnvironments}\n`);

  if (showGlobal) {
    await listEnvironmentsIn(ConfigPaths.environments, "global");
  }
  
  if (showLocal) {
    await listEnvironmentsIn(ConfigPaths.projectEnvironments, "local");
  }
}

async function listEnvironmentsIn(baseDir: string, source: string): Promise<void> {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const envs = entries.filter(e => e.isDirectory());

    if (envs.length === 0) {
      console.log(`  No ${source} environments`);
      return;
    }

    console.log(`  ${source} environments:`);
    for (const env of envs) {
      const configPath = path.join(baseDir, env.name, "config.jsonc");
      let displayName = env.name;
      try {
        const content = await fs.readFile(configPath, "utf-8");
        const config = JSON.parse(content);
        displayName = config.displayName || config.environment?.displayName || env.name;
      } catch {}
      console.log(`    - ${env.name}${displayName !== env.name ? ` (${displayName})` : ""}`);
    }
  } catch (error) {
    console.log(`  No ${source} environments (directory does not exist)`);
  }
  console.log();
}

export const EnvCommand: CommandModule<object, {}> = {
  command: "env",
  describe: "Manage tong_work environments",
  builder: (yargs) => {
    return yargs
      .command({
        command: "install <source>",
        describe: [
          "Install environment from a folder",
          "",
          "The source folder should contain:",
          "  - config.jsonc (required)",
          "  - skills/ (optional)",
          "  - mcpservers/ (optional)",
          "  - eventsources/ (optional)",
          "",
          "MCP server paths should be relative to the environment root.",
          "Example: 'mcpservers/my-mcp/server.js' not 'src/index.js'",
        ].join("\n"),
        builder: (yargs) =>
          yargs
            .positional("source", {
              describe: "Source folder path (file://... or absolute path)",
              type: "string",
              demandOption: true,
            })
            .option("global", {
              describe: "Install to global environments (~/.config/tong_work/agent-core/environments/)",
              type: "boolean",
              default: false,
            })
            .option("local", {
              describe: "Install to local (project) environments (.tong_work/environments/)",
              type: "boolean",
              default: true,
            })
            .option("name", {
              describe: "Environment name (default: folder name)",
              type: "string",
            })
            .option("force", {
              describe: "Overwrite if environment already exists",
              type: "boolean",
              default: false,
            }),
        handler: async (args) => {
          await handleInstall(args as any);
        },
      })
      .command({
        command: "list",
        describe: "List installed environments",
        builder: (yargs) =>
          yargs
            .option("global", {
              describe: "Show only global environments",
              type: "boolean",
              default: false,
            })
            .option("local", {
              describe: "Show only local environments",
              type: "boolean",
              default: false,
            }),
        handler: async (args) => {
          await handleList(args as any);
        },
      })
      .demandCommand();
  },

  handler() {},
};
