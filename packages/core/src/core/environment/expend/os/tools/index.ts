/**
 * @fileoverview OS Environment Tools
 * Provides tools for bash commands, file operations, etc.
 */

export * from "./bash.js";
export * from "./file.js";
export * from "./todo.js";
export * from "./filesystem.js";

// Re-export tool creators for convenience
export { createBashTool } from "./bash.js";
export { createFileTools, createOsTools as createBaseTools } from "./file.js";
export { createTodoTools, createTodoReadTool, createTodoWriteTool, createTodoAddTool } from "./todo.js";

// Re-export filesystem utilities
export {
  normalizePath,
  normalizeGitBashPath,
  isAbsolute,
  resolvePath,
  getRelativePath,
  getDirname,
  isSubpath,
  pathsOverlap,
} from "./filesystem.js";

// Web tools - for environments that support web access
export { createWebFetchTool } from "../../../../../tools/web/web-fetch.js";
