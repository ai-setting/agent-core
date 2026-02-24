/**
 * @fileoverview Language extension mapping for LSP
 * Maps file extensions to language IDs
 */

import path from "path";

/**
 * File extension to language ID mapping
 */
export const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".cpp": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".zig": "zig",
  ".vue": "vue",
  ".svelte": "svelte",
  ".astro": "astro",
};

/**
 * Code file extensions that need LSP diagnostics
 * Non-code files (like .md, .txt, .json) will skip LSP
 */
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts",
  ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".pyi",
  ".go",
  ".rs",
  ".java", ".kt", ".kts",
  ".cpp", ".c", ".h", ".hpp",
  ".cs",
  ".rb",
  ".php",
  ".swift",
  ".zig",
  ".vue", ".svelte", ".astro",
]);

/**
 * Check if a file needs LSP diagnostics
 * @param filePath - The file path to check
 * @returns true if the file should be processed by LSP
 */
export function needsLSPDiagnostics(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return CODE_EXTENSIONS.has(ext);
}

/**
 * Get language ID from file extension
 * @param filePath - The file path
 * @returns The language ID or undefined
 */
export function getLanguageId(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGE_EXTENSIONS[ext];
}

/**
 * Get all supported extensions
 * @returns Array of supported file extensions
 */
export function getSupportedExtensions(): string[] {
  return Array.from(CODE_EXTENSIONS);
}
