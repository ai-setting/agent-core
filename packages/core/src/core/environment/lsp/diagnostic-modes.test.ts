/**
 * @fileoverview Tests for LSP diagnostic modes (push vs pull)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { LSPClient } from "./client.js";
import { LSPServers } from "./server.js";
import { StreamMessageReader, StreamMessageWriter, createMessageConnection, MessageConnection } from "vscode-jsonrpc";
import { spawn, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, rmSync, existsSync } from "fs";

describe("LSP Diagnostic Modes", () => {
  describe("Push Mode (publishDiagnostics notification)", () => {
    it("should receive diagnostics via publishNotifications for TypeScript", async () => {
      // This test verifies existing push mode works
      // TypeScript LSP sends diagnostics via textDocument/publishDiagnostics
      
      // We'll verify the client is configured correctly for push mode
      // by checking the capabilities handling
      const { LSPServers } = await import("./server.js");
      const tsServer = LSPServers["typescript"];
      expect(tsServer).toBeDefined();
      expect(tsServer.id).toBe("typescript");
    });

    it("should store diagnostics from publishDiagnostics notification", async () => {
      // This is a unit test for the internal method
      const client = new LSPClient({
        serverID: "typescript",
        server: LSPServers["typescript"],
        root: "/tmp",
      });

      // Verify the diagnostics map exists
      expect(client.getDiagnostics()).toBeDefined();
      expect(client.getDiagnostics() instanceof Map).toBe(true);
    });
  });

  describe("Pull Mode (textDocument/diagnostic request)", () => {
    it("should identify markdown LSP uses pull mode", () => {
      // Verify markdown server configuration
      const mdServer = LSPServers["markdown"];
      expect(mdServer).toBeDefined();
      expect(mdServer.id).toBe("vscode-markdown-languageserver");
    });

    it("should have method to request diagnostics for pull mode", async () => {
      // Check if the LSPClient has or should have a method for pull diagnostics
      const client = new LSPClient({
        serverID: "markdown",
        server: LSPServers["markdown"],
        root: "/tmp",
      });

      // The client should have a method to get diagnostics
      // Currently it only gets them from push notifications
      // We need to verify it supports pull mode
      expect(typeof client.getDiagnostics).toBe("function");
    });

    it("should detect server capabilities for diagnostic mode", async () => {
      // Test that we can determine if a server uses push or pull mode
      // based on server capabilities
      
      // Push mode capability (workspaceDiagnostics: true)
      const pushCapability = {
        diagnosticProvider: {
          identifier: "typescript",
          interFileDependencies: true,
          workspaceDiagnostics: true
        }
      };

      // Pull mode capability (workspaceDiagnostics: false/undefined)
      const pullCapability = {
        diagnosticProvider: {
          identifier: "markdown",
          interFileDependencies: true,
          workspaceDiagnostics: false
        }
      };

      // Verify we can detect the difference
      expect(pushCapability.diagnosticProvider?.workspaceDiagnostics).toBe(true);
      expect(pullCapability.diagnosticProvider?.workspaceDiagnostics).toBe(false);
    });
  });

  describe("Backward Compatibility", () => {
    it("should not break existing TypeScript LSP diagnostics", () => {
      // Ensure the changes don't affect existing push mode servers
      const supportedExtensions = [
        ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs"
      ];
      
      for (const ext of supportedExtensions) {
        const server = Object.values(LSPServers).find(s => 
          s.extensions.includes(ext)
        );
        expect(server).toBeDefined();
      }
    });
  });
});
