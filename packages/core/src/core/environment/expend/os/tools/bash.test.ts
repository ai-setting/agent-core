/**
 * @fileoverview Unit tests for the bash tool.
 * Tests the bash tool interface and core functionality across platforms.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join, normalize } from "path";
import { tmpdir } from "os";
import { bash, createBashTool } from "./bash.js";

const isWindows = process.platform === "win32";

describe("Bash Tool - Basic Command Execution", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = join(tmpdir(), `agent-core-bash-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("should execute simple echo command", async () => {
    const result = await bash("echo 'Hello World'");
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("Hello World");
    expect(result.exitCode).toBe(0);
  });

  test("should capture stdout output", async () => {
    const result = await bash("echo test-output");
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("test-output");
  });

  test("should capture stderr output", async () => {
    const result = await bash("echo 'error msg' >&2");
    expect(result.stderr).toContain("error msg");
  });

  test("should measure execution duration", async () => {
    const result = await bash("echo 'test'");
    expect(result.success).toBe(true);
    expect(typeof result.duration).toBe("number");
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  test("should return exit code 0 on success", async () => {
    const result = await bash("echo success");
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("should return non-zero exit code on failure", async () => {
    const result = await bash("exit 1");
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test("should capture specific exit codes", async () => {
    const result = await bash("exit 42");
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(42);
  });

  test("should handle command not found", async () => {
    const result = await bash("nonexistent-command-xyz-12345");
    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });
});

describe("Bash Tool - Working Directory", () => {
  // Use system temp directory for cross-platform compatibility
  let testDir: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `agent-core-bash-cwd-test-${Date.now()}`);
    // Use Node.js API for cross-platform directory creation
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "test-file.txt"), "test content");
  });

  afterAll(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("should execute command in specified cwd", async () => {
    const result = await bash("pwd", { cwd: testDir });
    expect(result.success).toBe(true);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  test("should find files in specified cwd", async () => {
    const result = await bash("ls", { cwd: testDir });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("test-file.txt");
  });
});

describe("Bash Tool - Environment Variables", () => {
  test("should set custom environment variables on Unix", async () => {
    if (isWindows) return;
    const result = await bash("echo $CUSTOM_VAR", {
      env: { CUSTOM_VAR: "custom-value" },
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("custom-value");
  });

  test("should set custom environment variables on Windows", async () => {
    if (!isWindows) return;
    const result = await bash("echo %CUSTOM_VAR%", {
      env: { CUSTOM_VAR: "custom-value" },
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("custom-value");
  });

  test("should support multiple environment variables on Unix", async () => {
    if (isWindows) return;
    const result = await bash("echo $VAR1:$VAR2", {
      env: { VAR1: "value1", VAR2: "value2" },
    });
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("value1");
    expect(result.stdout).toContain("value2");
  });

  test("should handle empty environment variable value", async () => {
    const result = await bash("echo $EMPTY_VAR", {
      env: { EMPTY_VAR: "" },
    });
    expect(result.success).toBe(true);
  });
});

describe("Bash Tool - Timeout Handling", () => {
  test("should complete quick commands", async () => {
    const result = await bash("echo 'quick'", { timeout: 10000 });
    expect(result.success).toBe(true);
    expect(result.duration).toBeLessThan(5000);
  });

  test("should handle timeout=0 as no timeout", async () => {
    const result = await bash("echo 'no timeout'", { timeout: 0 });
    expect(result.success).toBe(true);
  });

  test("should handle large timeout values", async () => {
    const result = await bash("echo 'test'", { timeout: 600000 });
    expect(result.success).toBe(true);
  });
});

describe("Bash Tool - Output Handling", () => {
  test("should capture small output", async () => {
    const result = await bash("echo 'small'");
    expect(result.success).toBe(true);
    expect(result.stdout.length).toBeLessThan(100);
  });

  test("should handle moderate output on Unix", async () => {
    if (isWindows) return;
    const result = await bash("seq 1 100 | tr '\\n' ','");
    expect(result.success).toBe(true);
    expect(result.stdout.length).toBeGreaterThan(100);
  });

  test("should handle moderate output on Windows", async () => {
    if (!isWindows) return;
    // Use a simpler command that works in both cmd and PowerShell
    const result = await bash("echo 1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20");
    expect(result.success).toBe(true);
    expect(result.stdout.length).toBeGreaterThan(50);
  });
});

describe("Bash Tool - Redirections", () => {
  // Use system temp directory for cross-platform compatibility
  let testDir: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `agent-core-bash-redir-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("should write to file with redirection on Unix", async () => {
    if (isWindows) return;
    const testFile = join(testDir, "output.txt");
    const result = await bash(`echo 'file content' > "${testFile}"`);
    expect(result.success).toBe(true);
    const readResult = await bash(`cat "${testFile}"`);
    expect(readResult.stdout).toContain("file content");
  });

  test("should write to file with redirection on Windows", async () => {
    if (!isWindows) return;
    // Helper to convert Windows backslashes to forward slashes for Git Bash
    // Backslashes in bash are escape characters, so C:\temp\file becomes C:<tab>emp<newline>ile
    const toBashPath = (p: string) => p.replace(/\\/g, '/');
    const testFile = toBashPath(join(testDir, "output.txt"));
    // Use forward slashes without quotes for redirection to work in Git Bash
    const result = await bash(`echo file content > ${testFile}`);
    expect(result.success).toBe(true);
    // Use cat command with forward slash path
    const readResult = await bash(`cat ${testFile}`);
    expect(readResult.stdout).toContain("file content");
  });

  test("should append to file with redirection on Unix", async () => {
    if (isWindows) return;
    const testFile = join(testDir, "append.txt");
    await bash(`echo 'line1' > "${testFile}"`);
    const result = await bash(`echo 'line2' >> "${testFile}"`);
    expect(result.success).toBe(true);
    const readResult = await bash(`cat "${testFile}"`);
    expect(readResult.stdout).toContain("line1");
    expect(readResult.stdout).toContain("line2");
  });
});

describe("Bash Tool - Pipes", () => {
  test("should pipe output to another command on Unix", async () => {
    if (isWindows) return;
    const result = await bash("echo 'hello world' | wc -w");
    expect(result.success).toBe(true);
    expect(result.stdout.trim()).toBe("2");
  });

  test("should pipe output to another command on Windows", async () => {
    if (!isWindows) return;
    const result = await bash("echo hello world | findstr hello");
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("hello");
  });
});

describe("Bash Tool - Tool Integration", () => {
  // Use system temp directory for cross-platform compatibility
  let testDir: string;

  beforeAll(async () => {
    testDir = join(tmpdir(), `agent-core-bash-tool-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(async () => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("should create bash tool with correct name", () => {
    const tool = createBashTool();
    expect(tool.name).toBe("bash");
  });

  test("should have proper parameter schema", () => {
    const tool = createBashTool();
    expect((tool.parameters as any).shape).toBeDefined();
    expect((tool.parameters as any).shape.command).toBeDefined();
  });

  test("should execute via tool interface", async () => {
    const tool = createBashTool();
    const result = await tool.execute({ command: "echo 'tool test'" }, {} as any);
    expect(result.success).toBe(true);
    expect(result.output).toContain("tool test");
  });

  test("should pass timeout parameter via tool interface", async () => {
    const tool = createBashTool();
    const result = await tool.execute(
      { command: "echo 'timeout test'", timeoutMs: 10000 },
      {} as any
    );
    expect(result.success).toBe(true);
  });

  test("should pass workdir parameter via tool interface", async () => {
    const tool = createBashTool();
    const result = await tool.execute(
      { command: "pwd", workdir: testDir },
      {} as any
    );
    expect(result.success).toBe(true);
    expect(result.output.length).toBeGreaterThan(0);
  });

  test("should report failure with exit code via tool interface", async () => {
    const tool = createBashTool();
    const result = await tool.execute({ command: "exit 42" }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toContain("42");
  });

  test("should handle command failure gracefully", async () => {
    const tool = createBashTool();
    const result = await tool.execute({ command: "false" }, {} as any);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("Bash Tool - Performance", () => {
  test("should execute simple command quickly", async () => {
    const start = Date.now();
    await bash("echo 'perf test'");
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(2000);
  });

  test("should handle multiple sequential commands", async () => {
    for (let i = 0; i < 5; i++) {
      const result = await bash(`echo 'cmd-${i}'`);
      expect(result.success).toBe(true);
    }
  });
});

describe("Bash Tool - Platform Compatibility", () => {
  test("should use $OS variable on Windows", async () => {
    if (!isWindows) return;
    const result = await bash("echo $OS");
    expect(result.success).toBe(true);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  test("should use %OS% on Windows cmd", async () => {
    if (!isWindows) return;
    const result = await bash("echo %OS%");
    expect(result.success).toBe(true);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  test("should use $HOSTNAME on Unix", async () => {
    if (isWindows) return;
    const result = await bash("echo $HOSTNAME");
    expect(result.success).toBe(true);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  test("should work with COMSPEC on Windows", async () => {
    if (!isWindows) return;
    const result = await bash("echo %COMSPEC%");
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("cmd.exe");
  });
});
