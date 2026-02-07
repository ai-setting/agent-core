/**
 * @fileoverview Bash tool for executing shell commands
 */

import { z } from "zod";
import type { ToolInfo } from "../../../../types/index.js";

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

  return new Promise((resolve) => {
    const child = exec(
      command,
      {
        cwd: options?.cwd ?? process.cwd(),
        env: { ...process.env, ...options?.env },
        encoding: "utf-8",
        maxBuffer,
        timeout: Math.floor(timeout / 1000),
        shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
        killSignal: "SIGTERM",
      },
      (error: Error | null, stdout: string, stderr: string) => {
        const duration = Date.now() - startTime;

        if (error) {
          if ((error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
            resolve({
              success: false,
              stdout,
              stderr,
              exitCode: null,
              signal: "SIGTERM",
              duration,
            });
            return;
          }

          resolve({
            success: false,
            stdout,
            stderr,
            exitCode: (error as NodeJS.ErrnoException).code === "ENOENT" ? 127 : 1,
            signal: null,
            duration,
          });
          return;
        }

        resolve({
          success: true,
          stdout,
          stderr,
          exitCode: 0,
          signal: null,
          duration,
        });
      },
    );

    if (timeout > 0) {
      setTimeout(() => {
        child.kill("SIGTERM");
      }, timeout);
    }
  });
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
