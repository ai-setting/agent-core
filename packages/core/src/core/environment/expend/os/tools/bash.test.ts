/**
 * @fileoverview Comprehensive unit tests for the bash tool.
 * Tests command execution, environment variables, timeout, working directory, and error handling.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, unlinkSync, mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { bash, type BashResult } from "./bash.js";
import { normalizeGitBashPath, normalizePath } from "./filesystem.js";

const isWindows = process.platform === "win32";

describe("Bash Tool - Helper Functions", () => {
  describe("normalizeGitBashPath", () => {
    test("should convert Git Bash paths to Windows format", () => {
      if (!isWindows) return;

      const input = "/c/Users/test/file.txt";
      const result = normalizeGitBashPath(input);
      expect(result).toContain("C:");
      expect(result).toContain("Users");
    });

    test("should return Unix paths unchanged", () => {
      if (isWindows) return;

      const input = "/home/user/file.txt";
      const result = normalizeGitBashPath(input);
      expect(result).toBe(input);
    });

    test("should handle empty string", () => {
      const result = normalizeGitBashPath("");
      expect(result).toBe("");
    });

    test("should handle non-Git-Bash paths", () => {
      const result = normalizeGitBashPath("/some/other/path");
      expect(result).toBe("/some/other/path");
    });
  });

  describe("normalizePath", () => {
    test("should normalize paths for current platform", () => {
      if (isWindows) {
        const result = normalizePath("C:\\Users\\test\\file.txt");
        expect(result).toBeTruthy();
      } else {
        const result = normalizePath("/home/user/file.txt");
        expect(result).toBe("/home/user/file.txt");
      }
    });
  });
});

describe("Bash Tool - Basic Execution", () => {
  const testDir = join(tmpdir(), `agent-core-bash-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Successful Commands", () => {
    test("should execute echo command", async () => {
      const result = await bash("echo 'Hello World'");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("Hello World");
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
    });

    test("should execute pwd command", async () => {
      const result = await bash("pwd");
      expect(result.success).toBe(true);
      expect(result.stdout.length).toBeGreaterThan(0);
      expect(result.exitCode).toBe(0);
    });

    test("should capture both stdout and stderr", async () => {
      const result = await bash("echo 'out'; echo 'err' >&2");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("out");
      expect(result.stderr).toContain("err");
    });

    test("should measure execution duration", async () => {
      const result = await bash("echo 'test'");
      expect(result.success).toBe(true);
      expect(typeof result.duration).toBe("number");
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    test("should execute commands with pipes", async () => {
      const result = await bash("echo 'line1\nline2\nline3' | head -n 2");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("line1");
      expect(result.stdout).toContain("line2");
      expect(result.stdout).not.toContain("line3");
    });

    test("should execute commands with redirects", async () => {
      const testFile = join(testDir, "redirect-test.txt");
      const result = await bash(`echo 'redirected content' > "${testFile}"`);
      expect(result.success).toBe(true);
      expect(existsSync(testFile)).toBe(true);
      const content = readFileSync(testFile, "utf-8");
      expect(content).toContain("redirected content");
    });

    test("should execute commands with subshells", async () => {
      const result = await bash("echo $(echo 'nested')");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("nested");
    });
  });

  describe("Error Handling", () => {
    test("should handle command not found", async () => {
      const result = await bash("nonexistent-command-12345");
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(127);
    });

    test("should handle permission denied", async () => {
      const scriptFile = join(testDir, "no-permission.sh");
      writeFileSync(scriptFile, "#!/bin/bash\necho 'test'");
      const result = await bash(scriptFile);
      expect(result.exitCode).toBe(126);
    });

    test("should handle syntax errors", async () => {
      const result = await bash("echo 'unclosed quote");
      expect(result.success).toBe(false);
    });

    test("should handle invalid redirections", async () => {
      const result = await bash("echo test > /nonexistent/directory/file.txt 2>&1");
      expect(result.success).toBe(false);
    });
  });

  describe("Working Directory", () => {
    test("should execute in specified cwd", async () => {
      const result = await bash("pwd", { cwd: testDir });
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe(testDir);
    });

    test("should execute relative path commands in cwd", async () => {
      writeFileSync(join(testDir, "test-file.txt"), "test content");
      const result = await bash("ls test-file.txt", { cwd: testDir });
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("test-file.txt");
    });

    test("should handle non-existent cwd gracefully", async () => {
      const result = await bash("pwd", { cwd: "/nonexistent/path/12345" });
      expect(result.success).toBe(false);
    });
  });

  describe("Environment Variables", () => {
    test("should inherit parent environment", async () => {
      const result = await bash("echo $HOME");
      expect(result.success).toBe(true);
      expect(result.stdout.length).toBeGreaterThan(0);
    });

    test("should set custom environment variables", async () => {
      const result = await bash("echo $CUSTOM_VAR", {
        env: { CUSTOM_VAR: "custom-value" },
      });
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("custom-value");
    });

    test("should override existing environment variables", async () => {
      const result = await bash("echo $PATH", {
        env: { PATH: "/custom/path" },
      });
      expect(result.success).toBe(true);
      expect(result.stdout).toBe("/custom/path");
    });

    test("should support multiple custom env vars", async () => {
      const result = await bash("echo $VAR1:$VAR2", {
        env: { VAR1: "value1", VAR2: "value2" },
      });
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("value1:value2");
    });

    test("should handle empty env var value", async () => {
      const result = await bash("echo $EMPTY_VAR", {
        env: { EMPTY_VAR: "" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("Timeout Handling", () => {
    test("should complete quickly without timeout", async () => {
      const result = await bash("echo 'quick'", { timeout: 10000 });
      expect(result.success).toBe(true);
      expect(result.duration).toBeLessThan(5000);
    });

    test("should respect timeout setting", async () => {
      const result = await bash("sleep 10 && echo 'done'", { timeout: 500 });
      expect(result.success).toBe(false);
      expect(result.exitCode).toBeNull();
      expect(result.signal).toBe("SIGTERM");
    });

    test("should return signal on timeout", async () => {
      const result = await bash("sleep 5", { timeout: 100 });
      expect(result.success).toBe(false);
      expect(result.signal).toBe("SIGTERM");
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

  describe("Output Size Limits", () => {
    test("should capture small output", async () => {
      const result = await bash("echo 'small'");
      expect(result.success).toBe(true);
      expect(result.stdout.length).toBeLessThan(100);
    });

    test("should handle moderate output", async () => {
      const result = await bash("seq 1 100 | tr '\n' ','");
      expect(result.success).toBe(true);
      expect(result.stdout.length).toBeGreaterThan(100);
    });

    test("should respect maxBuffer option", async () => {
      const result = await bash("seq 1 10000 | tr '\n' ','", { maxBuffer: 1024 });
      expect(result.success).toBe(false);
    });
  });

  describe("Special Characters", () => {
    test("should handle Unicode output", async () => {
      const result = await bash("echo '你好世界 🌍'");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("你好世界");
    });

    test("should handle special shell characters", async () => {
      const result = await bash("echo 'Test: $HOME && echo done || echo fail'");
      expect(result.success).toBe(true);
    });

    test("should handle newlines in output", async () => {
      const result = await bash("printf 'line1\nline2\nline3\n'");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("line1");
      expect(result.stdout).toContain("line2");
    });

    test("should handle backticks", async () => {
      const result = await bash("echo `echo backtick`");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("backtick");
    });

    test("should handle wildcard expansion", async () => {
      writeFileSync(join(testDir, "file1.txt"), "");
      writeFileSync(join(testDir, "file2.txt"), "");
      writeFileSync(join(testDir, "file3.md"), "");

      const result = await bash(`ls ${testDir}/*.txt`, { cwd: testDir });
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("file1.txt");
      expect(result.stdout).toContain("file2.txt");
      expect(result.stdout).not.toContain("file3.md");
    });
  });

  describe("Exit Codes", () => {
    test("should return exit code 0 for success", async () => {
      const result = await bash("true");
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
    });

    test("should return non-zero exit code for failure", async () => {
      const result = await bash("false");
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
    });

    test("should capture specific exit codes", async () => {
      const result = await bash("exit 42");
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(42);
    });

    test("should handle exit in pipeline", async () => {
      const result = await bash("(exit 5) || echo 'caught error'");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("caught error");
    });
  });

  describe("Signal Handling", () => {
    test("should handle SIGTERM gracefully", async () => {
      const result = await bash("trap 'echo caught' TERM; sleep 30 & wait $! && echo 'done'", {
        timeout: 500,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Command Chaining", () => {
    test("should handle && chaining", async () => {
      const result = await bash("echo 'first' && echo 'second' && echo 'third'");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("first");
      expect(result.stdout).toContain("second");
      expect(result.stdout).toContain("third");
    });

    test("should handle || chaining", async () => {
      const result = await bash("false || echo 'recovered'");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("recovered");
    });

    test("should handle ; chaining", async () => {
      const result = await bash("echo 'a'; echo 'b'; echo 'c'");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("a\nb\nc");
    });
  });

  describe("Complex Commands", () => {
    test("should handle for loops", async () => {
      const result = await bash("for i in 1 2 3; do echo $i; done");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("1");
      expect(result.stdout).toContain("2");
      expect(result.stdout).toContain("3");
    });

    test("should handle if statements", async () => {
      const result = await bash(`
        if [ 1 -eq 1 ]; then
          echo 'condition true'
        fi
      `);
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("condition true");
    });

    test("should handle while loops", async () => {
      const result = await bash("i=0; while [ $i -lt 3 ]; do i=$((i+1)); done; echo 'done'");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("done");
    });

    test("should handle command substitution", async () => {
      const result = await bash("RESULT=$(echo 'computed'); echo $RESULT");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("computed");
    });
  });

  describe("Security Considerations", () => {
    test("should handle commands with sensitive data", async () => {
      const result = await bash("echo 'secret-data' | grep -q 'secret' && echo 'found'");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("found");
    });
  });
});

describe("Bash Tool - Integration with createBashTool", () => {
  const testDir = join(tmpdir(), `agent-core-bash-tool-test-${Date.now()}`);
  const testFile = join(testDir, "output.txt");

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Tool Integration", () => {
    test("should create bash tool successfully", () => {
      const { createBashTool } = require("./bash.js");
      const tool = createBashTool();
      expect(tool.name).toBe("bash");
      expect(tool.description).toContain("Execute bash commands");
      expect(tool.parameters).toBeDefined();
    });

    test("should execute command via tool interface", async () => {
      const { createBashTool } = require("./bash.js");
      const tool = createBashTool();
      const result = await tool.execute({ command: `echo 'tool interface test'` }, {} as any);
      expect(result.success).toBe(true);
      expect(result.output).toContain("tool interface test");
    });

    test("should pass timeout parameter", async () => {
      const { createBashTool } = require("./bash.js");
      const tool = createBashTool();
      const result = await tool.execute(
        { command: "echo 'timeout test'", timeoutMs: 10000 },
        {} as any
      );
      expect(result.success).toBe(true);
    });

    test("should pass workdir parameter", async () => {
      const { createBashTool } = require("./bash.js");
      const tool = createBashTool();
      const result = await tool.execute(
        { command: "pwd", workdir: testDir },
        {} as any
      );
      expect(result.success).toBe(true);
      expect(result.output.trim()).toBe(testDir);
    });

    test("should handle command failure via tool interface", async () => {
      const { createBashTool } = require("./bash.js");
      const tool = createBashTool();
      const result = await tool.execute({ command: "exit 1" }, {} as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Exit");
    });

    test("should capture stderr in error message", async () => {
      const { createBashTool } = require("./bash.js");
      const tool = createBashTool();
      const result = await tool.execute(
        { command: "echo 'error message' >&2" },
        {} as any
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("error message");
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty command", async () => {
      const result = await bash("");
      expect(result.success).toBe(false);
    });

    test("should handle command with only whitespace", async () => {
      const result = await bash("   ");
      expect(result.success).toBe(true);
    });

    test("should handle command with comments", async () => {
      const result = await bash("# this is a comment\necho 'actual output'");
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("actual output");
      expect(result.stdout).not.toContain("comment");
    });

    test("should handle very long commands", async () => {
      const longArg = "x".repeat(10000);
      const result = await bash(`echo '${longArg}'`);
      expect(result.success).toBe(true);
    });
  });

  describe("Performance", () => {
    test("should complete simple command quickly", async () => {
      const start = Date.now();
      await bash("echo 'perf test'");
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(2000);
    });

    test("should handle multiple sequential commands", async () => {
      for (let i = 0; i < 5; i++) {
        const result = await bash(`echo 'command ${i}'`);
        expect(result.success).toBe(true);
      }
    });
  });
});

describe("Bash Tool - Cross-Platform Compatibility", () => {
  test("should detect correct shell for platform", () => {
    const expected = isWindows ? "cmd.exe" : isWindows ? "gitbash" : "/bin/bash";
  });

  test("should handle Windows-style paths in echo", async () => {
    if (isWindows) {
      const result = await bash("echo C:\\Users\\Test");
      expect(result.success).toBe(true);
    } else {
      const result = await bash("echo /home/test");
      expect(result.success).toBe(true);
    }
  });

  test("should handle platform-specific commands", async () => {
    const result = isWindows
      ? await bash("echo %OS%")
      : await bash("echo $HOSTNAME");
    expect(result.success).toBe(true);
  });

  test("should handle line endings consistently", async () => {
    const result = await bash("printf 'a\nb\nc\n'");
    expect(result.stdout).toContain("a");
    expect(result.stdout).toContain("b");
    expect(result.stdout).toContain("c");
  });
});
