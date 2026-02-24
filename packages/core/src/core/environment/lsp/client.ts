/**
 * @fileoverview LSP Client implementation
 * Handles JSON-RPC communication with LSP servers
 */

import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { pathToFileURL } from "url";
import { EventEmitter } from "events";
import type { LSPServerInfo, LSPServerHandle } from "./server.js";
import type { LSPDiagnostic } from "./diagnostics.js";
import { getLanguageId } from "./language.js";
import { createLogger } from "../../../utils/logger.js";

const lspLogger = createLogger("lsp:client", "server.log");

let requestId = 1;

interface LSPClientOptions {
  serverID: string;
  server: LSPServerInfo;
  root: string;
}

export class LSPClient extends EventEmitter {
  private serverID: string;
  private root: string;
  private server: LSPServerInfo;
  private process: ChildProcessWithoutNullStreams | null = null;
  private connection: MessageConnection | null = null;
  private diagnostics: Map<string, LSPDiagnostic[]> = new Map();
  private initialized = false;
  private pendingRequests: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }> = new Map();
  private readBuffer = "";

  constructor(options: LSPClientOptions) {
    super();
    this.serverID = options.serverID;
    this.root = options.root;
    this.server = options.server;
  }

  /**
   * Start the LSP server process
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        lspLogger.info(`Starting LSP server: ${this.serverID}`, { root: this.root });

        this.process = spawn(this.server.command[0], this.server.command.slice(1), {
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, ...this.server.env },
        });

        this.process.stdout.on("data", (data: Buffer) => this.handleData(data));
        this.process.stderr.on("data", (data: Buffer) => {
          lspLogger.debug(`[${this.serverID}] stderr: ${data.toString()}`);
        });

        this.process.on("error", (error) => {
          lspLogger.error(`LSP server process error: ${this.serverID}`, { error: error.message });
          this.emit("error", error);
        });

        this.process.on("exit", (code) => {
          lspLogger.info(`LSP server exited: ${this.serverID}`, { code });
          this.emit("exit", code);
        });

        // Wait for process to be ready
        this.process.stdout.once("data", () => {
          resolve();
        });

        // Timeout fallback
        setTimeout(() => {
          if (!this.initialized) {
            resolve(); // Resolve anyway to allow fallback
          }
        }, 5000);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Handle incoming data from LSP server
   */
  private handleData(data: Buffer): void {
    this.readBuffer += data.toString();

    // Try to parse messages
    while (this.readBuffer.includes("\r\n\r\n")) {
      const headerEnd = this.readBuffer.indexOf("\r\n\r\n");
      const header = this.readBuffer.slice(0, headerEnd);
      const bodyStart = headerEnd + 4;

      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!contentLengthMatch) {
        this.readBuffer = this.readBuffer.slice(bodyStart);
        continue;
      }

      const contentLength = parseInt(contentLengthMatch[1], 10);
      const bodyEnd = bodyStart + contentLength;

      if (this.readBuffer.length < bodyEnd) {
        break; // Wait for more data
      }

      const body = this.readBuffer.slice(bodyStart, bodyEnd);
      this.readBuffer = this.readBuffer.slice(bodyEnd);

      try {
        const message = JSON.parse(body);
        this.handleMessage(message);
      } catch (error) {
        lspLogger.error("Failed to parse LSP message", { error });
      }
    }
  }

  /**
   * Handle incoming JSON-RPC message
   */
  private handleMessage(message: { id?: number; method?: string; result?: unknown; error?: unknown; params?: unknown }): void {
    // Handle response
    if (message.id !== undefined && this.pendingRequests.has(message.id)) {
      const pending = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);

      if (message.error) {
        pending.reject(new Error(JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    // Handle notification
    if (message.method) {
      this.handleNotification(message.method, message.params as Record<string, unknown>);
    }
  }

  /**
   * Handle LSP notification
   */
  private handleNotification(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case "textDocument/publishDiagnostics": {
        const uri = params.uri as string;
        const filePath = this.uriToPath(uri);
        const diagnostics = (params.diagnostics as Array<{
          range: { start: { line: number; character: number }; end: { line: number; character: number } };
          severity?: number;
          message: string;
          source?: string;
        }>)?.map((d) => ({
          range: d.range,
          severity: d.severity as LSPDiagnostic["severity"],
          message: d.message,
          source: d.source,
        })) || [];

        this.diagnostics.set(filePath, diagnostics);
        lspLogger.debug(`Diagnostics received for ${filePath}`, { count: diagnostics.length });
        this.emit("diagnostics", { filePath, diagnostics });
        break;
      }

      case "window/showMessage": {
        lspLogger.info(`[${this.serverID}] Show message:`, { message: params.message });
        break;
      }

      case "window/logMessage": {
        lspLogger.debug(`[${this.serverID}] Log message:`, { message: params.message });
        break;
      }

      default:
        lspLogger.debug(`[${this.serverID}] Unknown notification: ${method}`);
    }
  }

  /**
   * Send JSON-RPC request
   */
  private sendRequest<T>(method: string, params: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.process) {
        reject(new Error("LSP process not started"));
        return;
      }

      const id = requestId++;
      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject });

      const message = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      this.sendMessage(message);

      // Timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30000);
    });
  }

  /**
   * Send JSON-RPC notification (no response)
   */
  private sendNotification(method: string, params: Record<string, unknown>): void {
    const message = {
      jsonrpc: "2.0",
      method,
      params,
    };

    this.sendMessage(message);
  }

  /**
   * Send message to LSP server
   */
  private sendMessage(message: Record<string, unknown>): void {
    if (!this.process) {
      return;
    }

    const body = JSON.stringify(message);
    const header = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n`;
    this.process.stdin.write(header + body);
  }

  /**
   * Initialize the LSP client
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const rootUri = pathToFileURL(this.root).href;

    await this.sendRequest("initialize", {
      rootUri,
      processId: process.pid,
      capabilities: {
        textDocument: {
          synchronization: {
            willSave: false,
            didSave: true,
            willSaveWaitUntil: false,
          },
          publishDiagnostics: {},
        },
        workspace: {
          workspaceFolders: true,
        },
      },
      workspaceFolders: [{ uri: rootUri, name: "workspace" }],
    });

    this.initialized = true;
    this.sendNotification("initialized", {});
    lspLogger.info(`LSP client initialized: ${this.serverID}`);
  }

  /**
   * Open a document
   */
  async openDocument(filePath: string): Promise<void> {
    const { readFileSync } = await import("fs");
    const uri = pathToFileURL(filePath).href;
    const languageId = getLanguageId(filePath) || "plaintext";

    try {
      const content = readFileSync(filePath, "utf-8");
      this.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId,
          version: 0,
          text: content,
        },
      });
    } catch {
      // File might not exist yet
      this.sendNotification("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId,
          version: 0,
          text: "",
        },
      });
    }
  }

  /**
   * Change a document
   */
  async changeDocument(filePath: string, content: string): Promise<void> {
    const uri = pathToFileURL(filePath).href;
    this.sendNotification("textDocument/didChange", {
      textDocument: { uri, version: 1 },
      contentChanges: [{ text: content }],
    });
  }

  /**
   * Get diagnostics for a file
   */
  getDiagnostics(filePath?: string): Map<string, LSPDiagnostic[]> {
    if (filePath) {
      return new Map([[filePath, this.diagnostics.get(filePath) || []]]);
    }
    return new Map(this.diagnostics);
  }

  /**
   * Wait for diagnostics after document change
   */
  async waitForDiagnostics(filePath: string, timeoutMs = 3000): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, timeoutMs);

      const handler = ({ filePath: fp, diagnostics }: { filePath: string; diagnostics: LSPDiagnostic[] }) => {
        if (fp === filePath) {
          clearTimeout(timeout);
          this.off("diagnostics", handler);
          resolve();
        }
      };

      this.on("diagnostics", handler);
    });
  }

  /**
   * Send textDocument/definition request
   */
  async getDefinition(filePath: string, line: number, character: number): Promise<unknown> {
    const uri = pathToFileURL(filePath).href;
    return this.sendRequest("textDocument/definition", {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 },
    });
  }

  /**
   * Send textDocument/references request
   */
  async getReferences(filePath: string, line: number, character: number): Promise<unknown> {
    const uri = pathToFileURL(filePath).href;
    return this.sendRequest("textDocument/references", {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 },
      context: { includeDeclaration: true },
    });
  }

  /**
   * Send textDocument/hover request
   */
  async getHover(filePath: string, line: number, character: number): Promise<unknown> {
    const uri = pathToFileURL(filePath).href;
    return this.sendRequest("textDocument/hover", {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 },
    });
  }

  /**
   * Send textDocument/documentSymbol request
   */
  async getDocumentSymbols(filePath: string): Promise<unknown> {
    const uri = pathToFileURL(filePath).href;
    return this.sendRequest("textDocument/documentSymbol", {
      textDocument: { uri },
    });
  }

  /**
   * Send workspace/symbol request
   */
  async getWorkspaceSymbols(query: string): Promise<unknown> {
    return this.sendRequest("workspace/symbol", {
      query,
    });
  }

  /**
   * Convert URI to file path
   */
  private uriToPath(uri: string): string {
    try {
      return pathToFileURL(uri).href.replace(/^file:\/\//, "");
    } catch {
      return uri;
    }
  }

  /**
   * Shutdown the LSP client
   */
  async shutdown(): Promise<void> {
    try {
      await this.sendRequest("shutdown", {});
    } catch {
      // Ignore
    }

    this.sendNotification("exit", {});
    this.process?.kill();
    this.process = null;
    this.connection = null;
    this.diagnostics.clear();
  }

  /**
   * Get server info
   */
  getServerID(): string {
    return this.serverID;
  }

  getRoot(): string {
    return this.root;
  }
}

export interface MessageConnection {
  sendRequest: <T>(method: string, params: unknown) => Promise<T>;
  sendNotification: (method: string, params: unknown) => void;
  onNotification: (method: string, handler: (params: unknown) => void) => void;
  dispose: () => void;
}

/**
 * Create LSP client
 */
export async function createLSPClient(options: LSPClientOptions): Promise<LSPClient> {
  const client = new LSPClient(options);
  await client.start();
  await client.initialize();
  return client;
}
