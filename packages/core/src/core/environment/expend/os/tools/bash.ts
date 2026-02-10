/**
 * @fileoverview Bash tool for executing shell commands
 * Includes cross-platform compatibility for Windows, macOS, and Linux
 */

import { z } from "zod";
import type { ToolInfo } from "../../../../types/index.js";
import { spawn, type ChildProcess } from "child_process";
import { normalizeGitBashPath, normalizePath } from "./filesystem.js";

const SIGKILL_TIMEOUT_MS = 200;

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

  const { shell, args } = getShellConfig(command);

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    const cwd = options?.cwd ?? process.cwd();
    const normalizedCwd = process.platform === "win32" && cwd.startsWith("/")
      ? normalizeGitBashPath(cwd)
      : cwd;

    const child = spawn(shell, args, {
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
 * @returns The shell path and arguments
 */
function getShellConfig(command: string): { shell: string; args: string[] } {
  if (process.platform === "win32") {
    const gitPath = resolveGitBashPath();
    if (gitPath) {
      return { shell: gitPath, args: ["-c", command] };
    }
    const comspec = process.env.COMSPEC || "cmd.exe";
    return { shell: comspec, args: ["/c", command] };
  }

  if (process.platform === "darwin") {
    const shell = process.env.SHELL || "/bin/zsh";
    return { shell, args: ["-c", command] };
  }

  const shell = process.env.SHELL || "sh";
  const shellName = shell.split("/").pop() || "sh";

  if (shellName === "fish") {
    const bash = resolveBashPath();
    if (bash) {
      return { shell: bash, args: ["-c", command] };
    }
  }

  return { shell, args: ["-c", command] };
}

/**
 * Resolve Git Bash executable path on Windows.
 *
 * @returns The Git Bash path or null if not found
 */
function resolveGitBashPath(): string | null {
  try {
    const { execSync } = require("child_process");
    const gitPath = execSync("where git", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] })
      .toString()
      .trim()
      .split("\n")[0];

    if (gitPath) {
      const gitRoot = gitPath.replace(/\\cmd\\git\.exe$/i, "").replace(/\\mingw64\\bin\\git\.exe$/i, "");
      const fs = require("fs");
      const bashPath = `${gitRoot}\\usr\\bin\\bash.exe`;
      if (fs.existsSync(bashPath)) {
        return bashPath;
      }
      const altBashPath = `${gitRoot}\\bin\\bash.exe`;
      if (fs.existsSync(altBashPath)) {
        return altBashPath;
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
    description: "Execute bash commands in the working directory",
    parameters: z.object({
      command: z.string().describe("The bash command to execute"),
      timeoutMs: z.number().optional().describe("Timeout in milliseconds (default: 60000)"),
      workdir: z.string().optional().describe("Working directory"),
    }),
    execute: async (args) => {
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
        timeout: args.timeoutMs,
      });

      return {
        success: result.success,
        output: result.stdout || result.stderr,
        error: result.success ? undefined : `Exit ${result.exitCode}: ${result.stderr}`,
      };
    },
  };
}
