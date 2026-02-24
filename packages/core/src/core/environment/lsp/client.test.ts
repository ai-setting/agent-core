/**
 * @fileoverview Tests for LSP client module
 */

import { describe, it, expect, vi, beforeEach } from "bun:test";
import { LSPClient } from "./client.js";

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

    it("should return binPath for bun global install", async () => {
      process.env.BUN_INSTALL_BIN_DIR = "C:\\Users\\test\\.bun\\bin";
      
      const { ensureCommandExists } = await import("./client.js");
      const result = await ensureCommandExists("node-that-does-not-exist-xyz", "bun add -g some-package");
      
      expect(result.exists).toBe(false);
      expect(result.binPath).toBe("C:\\Users\\test\\.bun\\bin");
    });

    it("should use BUN_PREFIX as fallback for binPath", async () => {
      delete process.env.BUN_INSTALL_BIN_DIR;
      process.env.BUN_PREFIX = "C:\\Users\\test\\.bun";
      
      const { ensureCommandExists } = await import("./client.js");
      const result = await ensureCommandExists("node-that-does-not-exist-xyz", "bun add -g some-package");
      
      expect(result.binPath).toBe("C:\\Users\\test\\.bun\\bin");
    });

    it("should not return binPath for non-bun install commands", async () => {
      delete process.env.BUN_INSTALL_BIN_DIR;
      delete process.env.BUN_PREFIX;
      
      const { ensureCommandExists } = await import("./client.js");
      const result = await ensureCommandExists("node-that-does-not-exist-xyz", "pip install pyright");
      
      expect(result.exists).toBe(false);
      expect(result.binPath).toBeUndefined();
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
});
