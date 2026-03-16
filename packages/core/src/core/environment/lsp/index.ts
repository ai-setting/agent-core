/**
 * @fileoverview LSP Manager - Central API for LSP operations
 */

import { EventEmitter } from "events";
import path from "path";
import { LSPClient, createLSPClient } from "./client.js";
import { LSPServers, getRootFinder, type LSPServerInfo } from "./server.js";
import { needsLSPDiagnostics, getLanguageId, getSupportedExtensions } from "./language.js";
import type { LSPDiagnostic } from "./diagnostics.js";
import { createLogger } from "../../../utils/logger.js";

const lspLogger = createLogger("lsp:manager", "server.log");

// Re-export from language.ts
export { needsLSPDiagnostics, getLanguageId, getSupportedExtensions };

export type LSPOperation =
  | "goToDefinition"
  | "findReferences"
  | "hover"
  | "documentSymbol"
  | "workspaceSymbol"
  | "goToImplementation";

export interface LSPConfig {
  disabled?: boolean;
  servers?: Partial<Record<string, LSPServerInfo>>;
}

interface ClientEntry {
  client: LSPClient;
  root: string;
  serverID: string;
}

/**
 * LSP Manager - manages LSP clients for different servers
 */
export class LSPManager extends EventEmitter {
  private clients: Map<string, ClientEntry> = new Map();
  private spawning: Map<string, Promise<LSPClient | undefined>> = new Map();
  private servers: Map<string, LSPServerInfo> = new Map();
  private broken: Set<string> = new Set();

  constructor(config?: LSPConfig) {
    super();

    // Initialize default servers
    for (const [id, server] of Object.entries(LSPServers)) {
      this.servers.set(id, server);
    }

    // Override with config
    if (config?.servers) {
      for (const [id, server] of Object.entries(config.servers)) {
        if (server) {
          this.servers.set(id, server);
        }
      }
    }
  }

  /**
   * Check if LSP is needed for a file
   */
  needsLSP(filePath: string): boolean {
    const result = needsLSPDiagnostics(filePath);
    // Checking if LSP needed debug // 已精简
    return result;
  }

  /**
   * Get LSP clients for a file
   */
  async getClients(filePath: string): Promise<LSPClient[]> {
    const ext = path.extname(filePath).toLowerCase();
    // Getting clients debug // 已精简
    
    const results: LSPClient[] = [];

    for (const [id, server] of this.servers) {
      if (!server.extensions.includes(ext)) {
        // Skipping server debug // 已精简
        continue;
      }
      if (this.broken.has(id)) {
        // Marked as broken debug // 已精简
        continue;
      }

      const rootFinder = getRootFinder(server);
      const root = await rootFinder(filePath);
      // Root finder result debug // 已精简
      
      if (!root) {
        // No root debug // 已精简
        continue;
      }

      const key = `${root}:${id}`;
      const existing = this.clients.get(key);
      if (existing) {
        // Using existing client debug // 已精简
        results.push(existing.client);
        continue;
      }

      const client = await this.getOrCreateClient(id, server, root);
      if (client) results.push(client);
    }

    lspLogger.info("LSP Manager: Clients found", { filePath, count: results.length });
    return results;
  }

  /**
   * Get or create an LSP client
   */
  private async getOrCreateClient(
    id: string,
    server: LSPServerInfo,
    root: string
  ): Promise<LSPClient | undefined> {
    const key = `${root}:${id}`;

    if (this.spawning.has(key)) {
      return this.spawning.get(key);
    }

    const task = this.createClient(id, server, root);
    this.spawning.set(key, task);

    try {
      const client = await task;
      if (client) {
        this.clients.set(key, { client, root, serverID: id });
        this.emit("clientCreated", { serverID: id, root });
      }
      return client;
    } catch (error) {
      this.broken.add(key);
      lspLogger.error(`Failed to create LSP client: ${id}`, { error: (error as Error).message });
      return undefined;
    } finally {
      this.spawning.delete(key);
    }
  }

  /**
   * Create a new LSP client
   */
  private async createClient(
    id: string,
    server: LSPServerInfo,
    root: string
  ): Promise<LSPClient | undefined> {
    try {
      lspLogger.info(`Creating LSP client: ${id} for ${root}`);
      const client = await createLSPClient({ serverID: id, server, root });
      return client;
    } catch (error) {
      lspLogger.error(`Failed to start LSP server: ${id}`, { error: (error as Error).message });
      return undefined;
    }
  }

  /**
   * Touch a file - notify LSP and optionally wait for diagnostics
   */
  async touchFile(filePath: string, waitForDiagnostics = false): Promise<void> {
    lspLogger.info("LSP Manager: touchFile called", { filePath, waitForDiagnostics });
    
    const clients = await this.getClients(filePath);
    lspLogger.info("LSP Manager: Got clients for touchFile", { filePath, clientCount: clients.length });

    if (clients.length === 0) {
      lspLogger.warn("LSP Manager: No clients available for touchFile", { filePath });
    }

    await Promise.all(
      clients.map(async (client) => {
        await client.openDocument(filePath);

        if (waitForDiagnostics) {
          await client.waitForDiagnostics(filePath, 3000);
        }
      })
    );
    
    lspLogger.info("LSP Manager: touchFile completed", { filePath });
  }

  /**
   * Get all diagnostics
   * For push mode: returns cached diagnostics from publishNotifications
   * For pull mode: actively requests diagnostics via textDocument/diagnostic
   */
  async getDiagnostics(): Promise<Record<string, LSPDiagnostic[]>> {
    // getDiagnostics debug // 已精简
    const results: Record<string, LSPDiagnostic[]> = {};

    for (const { client, root } of this.clients.values()) {
      // Get all files in the workspace that have been opened
      const workspaceDiagnostics = client.getDiagnostics();
      // Diagnostics from client debug // 已精简
      
      for (const [filePath, diagnostics] of workspaceDiagnostics) {
        if (diagnostics.length > 0) {
          results[filePath] = (results[filePath] || []).concat(diagnostics);
        }
      }
    }

    lspLogger.info("LSP Manager: getDiagnostics completed", { totalFiles: Object.keys(results).length });
    return results;
  }

  /**
   * Execute an LSP operation
   */
  async executeOperation(
    operation: LSPOperation,
    filePath: string,
    line: number,
    character: number
  ): Promise<unknown> {
    const clients = await this.getClients(filePath);
    const results: unknown[] = [];

    for (const client of clients) {
      let result: unknown;

      switch (operation) {
        case "goToDefinition":
          result = await client.getDefinition(filePath, line, character);
          break;
        case "findReferences":
          result = await client.getReferences(filePath, line, character);
          break;
        case "hover":
          result = await client.getHover(filePath, line, character);
          break;
        case "documentSymbol":
          result = await client.getDocumentSymbols(filePath);
          break;
        case "workspaceSymbol":
          result = await client.getWorkspaceSymbols("");
          break;
      }

      if (result) {
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Check if there are LSP servers available for a file
   */
  async hasLSPForFile(filePath: string): Promise<boolean> {
    if (!needsLSPDiagnostics(filePath)) {
      return false;
    }

    const clients = await this.getClients(filePath);
    return clients.length > 0;
  }

  /**
   * Shutdown all clients
   */
  async shutdown(): Promise<void> {
    for (const { client } of this.clients.values()) {
      try {
        await client.shutdown();
      } catch (error) {
        lspLogger.error("Error shutting down client", { error: (error as Error).message });
      }
    }
    this.clients.clear();
  }

  /**
   * Get supported extensions
   */
  getSupportedExtensions(): string[] {
    const extensions = new Set<string>();
    for (const server of this.servers.values()) {
      for (const ext of server.extensions) {
        extensions.add(ext);
      }
    }
    return Array.from(extensions);
  }
}

// Default instance
export const lspManager = new LSPManager();
