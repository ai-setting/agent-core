/**
 * @fileoverview Bash tool for executing shell commands
 * Includes cross-platform compatibility for Windows, macOS, and Linux
 */

import { z } from "zod";
import type { ToolInfo } from "../../../../types/index.js";
import { spawn, type ChildProcess } from "child_process";
import { normalizeGitBashPath, resolvePath } from "./filesystem.js";

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

  const { exec } = await import("child_process");

  // Determine the appropriate shell for the platform
  const shell = getShell();

  return new Promise((resolve) => {
    const child = exec(
      command,
      {
        cwd: options?.cwd ?? process.cwd(),
        env: { ...process.env, ...options?.env },
        encoding: "utf-8",
        maxBuffer,
        timeout: Math.floor(timeout / 1000),
        shell,
        killSignal: "SIGTERM",
        detached: process.platform !== "win32",
      },
      (error: Error | null, stdout: string, stderr: string) => {
        const duration = Date.now() - startTime;

        // Normalize Git Bash paths on Windows
        const normalizedStdout = process.platform === "win32"
          ? normalizeGitBashPath(stdout)
          : stdout;
        const normalizedStderr = process.platform === "win32"
          ? normalizeGitBashPath(stderr)
          : stderr;

        if (error) {
          if ((error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
            resolve({
              success: false,
              stdout: normalizedStdout,
              stderr: normalizedStderr,
              exitCode: null,
              signal: "SIGTERM",
              duration,
            });
            return;
          }

          resolve({
            success: false,
            stdout: normalizedStdout,
            stderr: normalizedStderr,
            exitCode: (error as NodeJS.ErrnoException).code === "ENOENT" ? 127 : 1,
            signal: null,
            duration,
          });
          return;
        }

        resolve({
          success: true,
          stdout: normalizedStdout,
          stderr: normalizedStderr,
          exitCode: 0,
          signal: null,
          duration,
        });
      },
    );

    if (timeout > 0) {
      setTimeout(() => {
        killProcessTree(child);
      }, timeout);
    }
  });
}

/**
 * Get the appropriate shell for the current platform.
 *
 * @returns The shell command to use
 */
function getShell(): string {
  if (process.platform === "win32") {
    // On Windows, prefer Git Bash if available, otherwise use cmd.exe
    const gitPath = resolveGitBashPath();
    if (gitPath) {
      return gitPath;
    }
    return process.env.COMSPEC || "cmd.exe";
  }
  if (process.platform === "darwin") {
    return "/bin/zsh";
  }
  const bashPath = resolveBashPath();
  if (bashPath) {
    return bashPath;
  }
  return "/bin/sh";
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
      // git.exe is typically at: C:\Program Files\Git\cmd\git.exe
      // bash.exe is at: C:\Program Files\Git\bin\bash.exe
      const bashPath = gitPath.replace(/\\cmd\\git\.exe$/, "\\bin\\bash.exe");
      const fs = require("fs");
      if (fs.existsSync(bashPath)) {
        return bashPath;
      }
    }
  } catch {
    // Git not found or where command failed
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
    // On Windows, use taskkill to kill the process tree
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

  // On Unix-like systems, kill the process group
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
      const result = await bash(args.command, {
        cwd: args.workdir,
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
