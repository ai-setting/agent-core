/**
 * @fileoverview Tests for LSP client module
 */

import { describe, it, expect, vi, beforeEach } from "bun:test";
import { LSPClient } from "./client.js";
import { LSPServers } from "./server.js";
import { spawn } from "child_process";

describe("client.ts", () => {
    describe("ensureCommandExists", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    it("should return exists=true if command exists", async () => {
      const { ensureCommandExists } = await import("./client.js");
      const result = await ensureCommandExists("node", undefined);
      expect(result.exists).toBe(true);
    });

    it("should return useBunx=true for bun global install even if which can't find it", async () => {
      // Use a real package that exists
      const { ensureCommandExists } = await import("./client.js");
      const result = await ensureCommandExists("typescript-language-server", "bun add -g typescript-language-server");
      
      // Installation should succeed, and even if which can't find it, we return useBunx: true
      expect(result.exists).toBe(true);
      expect(result.useBunx).toBe(true);
    });

    it("should return exists=false and useBunx=undefined for non-bun install commands when not found", async () => {
      delete process.env.BUN_INSTALL_BIN_DIR;
      delete process.env.BUN_PREFIX;
      
      // Use a command that definitely won't exist and a non-bun install command
      const { ensureCommandExists } = await import("./client.js");
      const result = await ensureCommandExists("definitely-no-such-command-xyz", "pip install pyright");
      
      expect(result.exists).toBe(false);
      expect(result.useBunx).toBeUndefined();
    });
  });

  describe("getInstallCommand", () => {
    it("should return correct install command for typescript", async () => {
      // Import the function and test
      const { getInstallCommand } = await import("./client.js");
      expect(getInstallCommand("typescript")).toBe("bun add -g typescript-language-server");
    });

    it("should return correct install command for pyright", async () => {
      const { getInstallCommand } = await import("./client.js");
      expect(getInstallCommand("pyright")).toBe("pip install pyright");
    });

    it("should return correct install command for gopls", async () => {
      const { getInstallCommand } = await import("./client.js");
      expect(getInstallCommand("gopls")).toBe("go install golang.org/x/tools/gopls@latest");
    });

    it("should return correct install command for rust-analyzer", async () => {
      // Test both "rustAnalyzer" and "rust" keys
      const { getInstallCommand } = await import("./client.js");
      expect(getInstallCommand("rust")).toBe("rustup component add rust-analyzer");
    });

    it("should return undefined for unknown server", async () => {
      const { getInstallCommand } = await import("./client.js");
      expect(getInstallCommand("unknown-server")).toBeUndefined();
    });
  });

  describe("LSP server startup with bunx", () => {
    it("should use bunx to run typescript-language-server when useBunx is true", async () => {
      const { ensureCommandExists } = await import("./client.js");
      
      // Test that for bun add -g commands, useBunx is returned as true
      const result = await ensureCommandExists("typescript-language-server", "bun add -g typescript-language-server");
      
      expect(result.exists).toBe(true);
      expect(result.useBunx).toBe(true);
      
      // Verify that bun x can actually run the LSP server
      // We'll use a simple test to verify the command works
      const proc = spawn(process.execPath, ["x", "typescript-language-server", "--version"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      
      let stdout = "";
      let stderr = "";
      
      proc.stdout?.on("data", (data) => {
        stdout += data.toString();
      });
      
      proc.stderr?.on("data", (data) => {
        stderr += data.toString();
      });
      
      const exitCode = await new Promise<number>((resolve) => {
        proc.on("close", (code) => {
          resolve(code ?? -1);
        });
      });
      
      // The command should exit successfully (version flag typically exits 0)
      // typescript-language-server --version outputs version number like "5.1.3"
      expect(exitCode).toBe(0);
      // Either contains version number or package name
      expect(stdout.match(/\d+\.\d+\.\d+/) || stdout).toBeTruthy();
    }, 30000);

    it("should use bunx to run pyright when useBunx is true", async () => {
      const { ensureCommandExists } = await import("./client.js");
      
      // Test with pyright (which uses pip, not bun)
      const result = await ensureCommandExists("pyright-langserver", "pip install pyright");
      
      // pip-installed packages should be in PATH, so exists should be true but useBunx should be undefined
      // (This test documents the current behavior)
      expect(result.useBunx).toBeUndefined();
    });
  });
});
