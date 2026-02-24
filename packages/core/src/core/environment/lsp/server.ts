/**
 * @fileoverview LSP Server definitions
 */

import path from "path";
import { existsSync } from "fs";

export interface LSPServerInfo {
  id: string;
  extensions: string[];
  command: string[];
  rootPatterns: string[];
  excludePatterns?: string[];
  env?: Record<string, string>;
  initializationOptions?: Record<string, unknown>;
}

export interface LSPServerHandle {
  process: {
    stdin: { write: (data: string) => boolean; end: () => void };
    stdout: { on: (event: string, callback: (data: Buffer) => void) => void };
    kill: () => void;
  };
  initializationOptions?: Record<string, unknown>;
}

type RootFinder = (file: string) => Promise<string | undefined>;

/**
 * Create a root finder that searches for patterns upward
 */
function createRootFinder(
  includePatterns: string[],
  excludePatterns?: string[]
): RootFinder {
  return async (file: string): Promise<string | undefined> => {
    let currentDir = path.dirname(file);

    while (currentDir !== path.dirname(currentDir)) {
      // Check for exclude patterns first
      if (excludePatterns) {
        const hasExcluded = excludePatterns.some((pattern) =>
          existsSync(path.join(currentDir, pattern))
        );
        if (hasExcluded) {
          return undefined;
        }
      }

      // Check for include patterns
      for (const pattern of includePatterns) {
        if (existsSync(path.join(currentDir, pattern))) {
          return currentDir;
        }
      }

      currentDir = path.dirname(currentDir);
    }

    return undefined;
  };
}

/**
 * Default LSP servers configuration
 */
export const LSPServers: Record<string, LSPServerInfo> = {
  typescript: {
    id: "typescript",
    extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
    command: ["typescript-language-server", "--stdio"],
    rootPatterns: ["package-lock.json", "bun.lock", "yarn.lock"],
    excludePatterns: ["deno.json", "deno.jsonc"],
  },

  pyright: {
    id: "pyright",
    extensions: [".py", ".pyi"],
    command: ["pyright-langserver", "--stdio"],
    rootPatterns: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"],
  },

  gopls: {
    id: "gopls",
    extensions: [".go"],
    command: ["gopls"],
    rootPatterns: ["go.mod", "go.work"],
  },

  rustAnalyzer: {
    id: "rust-analyzer",
    extensions: [".rs"],
    command: ["rust-analyzer"],
    rootPatterns: ["Cargo.toml"],
  },

  jdtls: {
    id: "jdtls",
    extensions: [".java"],
    command: ["jdtls"],
    rootPatterns: ["pom.xml", "build.gradle", "build.gradle.kts"],
  },

  kotlinLanguageServer: {
    id: "kotlin-language-server",
    extensions: [".kt", ".kts"],
    command: ["kotlin-language-server"],
    rootPatterns: ["build.gradle.kts", "pom.xml"],
  },

  clangd: {
    id: "clangd",
    extensions: [".cpp", ".c", ".h", ".hpp"],
    command: ["clangd"],
    rootPatterns: ["compile_commands.json", "CMakeLists.txt"],
  },

  csharp_ls: {
    id: "csharp-ls",
    extensions: [".cs"],
    command: ["csharp-ls"],
    rootPatterns: [".csproj", ".sln"],
  },

  ruby_ls: {
    id: "ruby-ls",
    extensions: [".rb"],
    command: ["ruby-ls"],
    rootPatterns: ["Gemfile"],
  },

  php_ls: {
    id: "php-ls",
    extensions: [".php"],
    command: ["php-language-server"],
    rootPatterns: ["composer.json"],
  },

  swift_langserver: {
    id: "swift-language-server",
    extensions: [".swift"],
    command: ["sourcekit-lsp"],
    rootPatterns: ["Package.swift"],
  },

  zls: {
    id: "zls",
    extensions: [".zig"],
    command: ["zls"],
    rootPatterns: ["build.zig"],
  },

  vue_language_server: {
    id: "vue-language-server",
    extensions: [".vue"],
    command: ["vue-language-server", "--stdio"],
    rootPatterns: ["package.json"],
  },

  svelte_ls: {
    id: "svelte-ls",
    extensions: [".svelte"],
    command: ["svelte-language-server", "--stdio"],
    rootPatterns: ["package.json"],
  },

  astro_ls: {
    id: "astro-ls",
    extensions: [".astro"],
    command: ["astro-ls", "--stdio"],
    rootPatterns: ["package.json"],
  },
};

/**
 * Get the root finder for a server
 */
export function getRootFinder(server: LSPServerInfo): RootFinder {
  return createRootFinder(server.rootPatterns, server.excludePatterns);
}

/**
 * Find server for a file extension
 */
export function findServerForFile(
  servers: Record<string, LSPServerInfo>,
  filePath: string
): LSPServerInfo | undefined {
  const ext = path.extname(filePath).toLowerCase();

  for (const server of Object.values(servers)) {
    if (server.extensions.includes(ext)) {
      return server;
    }
  }

  return undefined;
}
