/**
 * @fileoverview Bash tool for executing shell commands
 * Includes cross-platform compatibility for Windows, macOS and Linux
 */

import { z } from "zod";
import type { ToolInfo } from "../../../../types/index.js";
import { spawn, type ChildProcess } from "child_process";
import path from "path";
import { normalizeGitBashPath, normalizePath } from "./filesystem.js";

const SIGKILL_TIMEOUT_MS = 200;

function convertWindowsPathForBash(path: string): string {
  if (process.platform !== "win32") return path;
  
  // Match Windows paths like C:\Users\... or C:/Users/...
  // Convert to Unix-style paths that bash can understand
  return path.replace(/^([a-zA-Z]):[/\\]/, "/$1/").replace(/\\/g, "/");
}

export interface BashResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  duration: number;
}

export async function bash(
  command: string,
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    maxBuffer?: number;
  },
): Promise<BashResult> {
  const startTime = Date.now();
  const timeout = options?.timeout ?? 60000;
  const maxBuffer = options?.maxBuffer ?? 10 * 1024 * 1024;

  const { shell, useBash } = getShellConfig(command);
  
  // Convert Windows paths to Unix-style when using bash on Windows
  const convertedCommand = useBash ? convertWindowsPathForBash(command) : command;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    const cwd = options?.cwd ?? process.cwd();
    const normalizedCwd = process.platform === "win32" && cwd.startsWith("/")
      ? normalizeGitBashPath(cwd)
      : cwd;

    const child = spawn(shell, ["-c", convertedCommand], {
      cwd: normalizedCwd,
      env: { ...process.env, ...options?.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");

    child.stdout?.on("data", (data: string) => {
      stdout += data;
      if (stdout.length > maxBuffer) {
        child.kill("SIGTERM");
      }
    });

    child.stderr?.on("data", (data: string) => {
      stderr += data;
      if (stderr.length > maxBuffer) {
        child.kill("SIGTERM");
      }
    });

    child.on("close", (code: number | null, signal: string | null) => {
      if (killed) return;
      const duration = Date.now() - startTime;

      const normalizedStdout = process.platform === "win32"
        ? normalizeGitBashPath(stdout)
        : stdout;
      const normalizedStderr = process.platform === "win32"
        ? normalizeGitBashPath(stderr)
        : stderr;

      resolve({
        success: code === 0,
        stdout: normalizedStdout,
        stderr: normalizedStderr,
        exitCode: code,
        signal,
        duration,
      });
    });

    child.on("error", (error: Error) => {
      const duration = Date.now() - startTime;
      resolve({
        success: false,
        stdout,
        stderr: error.message,
        exitCode: 1,
        signal: null,
        duration,
      });
    });

    if (timeout > 0) {
      setTimeout(() => {
        killed = true;
        killProcessTree(child);
      }, timeout);
    }
  });
}

/**
 * Get the appropriate shell and arguments for the current platform.
 *
 * @param command - The command to execute
 * @returns The shell path, arguments, and whether bash is being used
 */
function getShellConfig(command: string): { shell: string; args: string[]; useBash: boolean } {
  if (process.platform === "win32") {
    const gitPath = resolveGitBashPath();
    if (gitPath) {
      return { shell: gitPath, args: ["-c", command], useBash: true };
    }
    const comspec = process.env.COMSPEC || "cmd.exe";
    return { shell: comspec, args: ["/c", command], useBash: false };
  }

  if (process.platform === "darwin") {
    const shell = process.env.SHELL || "/bin/zsh";
    return { shell, args: ["-c", command], useBash: true };
  }

  const shell = process.env.SHELL || "sh";
  const shellName = shell.split("/").pop() || "sh";

  if (shellName === "fish") {
    const bash = resolveBashPath();
    if (bash) {
      return { shell: bash, args: ["-c", command], useBash: true };
    }
  }

  return { shell, args: ["-c", command], useBash: shellName === "bash" };
}

/**
 * Resolve Git Bash executable path on Windows.
 * Uses Bun.which which returns clean paths without trailing \r
 *
 * @returns The Git Bash path or null if not found
 */
function resolveGitBashPath(): string | null {
  try {
    const Bun = require("bun");
    const gitPath = Bun.which("git");
    
    if (gitPath) {
      const fs = require("fs");
      const gitDir = path.dirname(gitPath);
      const parentDir = path.dirname(gitDir);
      const grandparentDir = path.dirname(parentDir);

      const possibleBashPaths = [
        path.join(parentDir, "usr", "bin", "bash.exe"),
        path.join(parentDir, "bin", "bash.exe"),
        path.join(grandparentDir, "Git", "usr", "bin", "bash.exe"),
        path.join(grandparentDir, "Git", "bin", "bash.exe"),
      ];
      
      for (const bashPath of possibleBashPaths) {
        if (fs.existsSync(bashPath)) {
          return bashPath;
        }
      }
    }
  } catch {
  }
  return null;
}

/**
 * Resolve bash executable path on Unix-like systems.
 *
 * @returns The bash path or null if not found
 */
function resolveBashPath(): string | null {
  try {
    const { execSync } = require("child_process");
    const bashPath = execSync("which bash", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] })
      .toString()
      .trim();
    return bashPath || null;
  } catch {
    return null;
  }
}

/**
 * Kill a process tree, handling platform-specific differences.
 * On Windows, uses taskkill; on Unix, sends signals to the process group.
 *
 * @param proc - The process to kill
 */
async function killProcessTree(proc: ChildProcess): Promise<void> {
  const pid = proc.pid;
  if (!pid) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(pid), "/f", "/t"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
    await new Promise((r) => setTimeout(r, SIGKILL_TIMEOUT_MS));
    if (!proc.killed) {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    proc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, SIGKILL_TIMEOUT_MS));
    if (!proc.killed) {
      proc.kill("SIGKILL");
    }
  }
}

export function createBashTool(): ToolInfo {
  return {
    name: "bash",
    description: `Executes a given bash command in a persistent shell session with optional timeout, ensuring proper handling and security measures.

All commands run in the working directory by default. Use the workdir parameter if you need to run a command in a different directory. AVOID using cd <directory> && <command> patterns - use workdir instead.

IMPORTANT: This tool is for terminal operations like git, npm, docker, etc. DO NOT use it for file operations (reading, writing, editing, searching, finding files) - use the specialized tools for this instead.

Before executing the command, please follow these steps:
1. Directory Verification: If the command will create new directories or files, first use ls to verify the parent directory exists and is the correct location.
2. Command Execution: Always quote file paths that contain spaces with double quotes (e.g., rm "path with spaces/file.txt").

Usage notes:
- The command argument is required.
- You can specify an optional timeout in milliseconds. If not specified, commands will time out after 120000ms (2 minutes).
- It is very helpful if you write a clear, concise description of what this command does in 5-10 words.
- Avoid using Bash with the find, grep, cat, head, tail, sed, awk, or echo commands, unless explicitly instructed. Instead, always prefer using the dedicated tools.
- When issuing multiple commands: If the commands are independent and can run in parallel, use multiple Bash tool calls. If they depend on each other, use && to chain them.
- AVOID using cd <directory> && <command>. Use the workdir parameter to change directories instead.`,
    parameters: z.object({
      command: z.string().describe("The bash command to execute"),
      timeout: z.number().optional().describe("Optional timeout in milliseconds (default: 60000)"),
      workdir: z.string().optional().describe("Working directory"),
      description: z.string().optional().describe("Clear, concise description of what this command does in 5-10 words"),
    }),
    execute: async (args) => {
      const { shell, useBash } = getShellConfig(args.command);
      
      // Normalize and resolve workdir for cross-platform compatibility
      let normalizedWorkdir: string | undefined;
      if (args.workdir) {
        // Expand ~ to home directory
        const expandedWorkdir = args.workdir.startsWith("~")
          ? args.workdir.replace(/^~/, process.env.HOME || process.env.USERPROFILE || "")
          : args.workdir;
        
        // Normalize path for the current platform
        normalizedWorkdir = normalizePath(expandedWorkdir);
      }

      const result = await bash(args.command, {
        cwd: normalizedWorkdir,
        timeout: args.timeout,
      });

      return {
        success: result.success,
        output: result.stdout || result.stderr,
        error: result.success ? undefined : `Exit ${result.exitCode}: ${result.stderr}`,
      };
    },
  };
}
