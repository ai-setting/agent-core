/**
 * @fileoverview Cross-platform filesystem utilities
 * Provides OS-specific path handling and normalization
 */

import { realpathSync } from "fs";
import { dirname, join, relative } from "path";

/**
 * Normalize a path for the current platform.
 * On Windows, handles case-insensitive paths and converts between formats.
 *
 * @param p - The path to normalize
 * @returns The normalized path
 */
export function normalizePath(p: string): string {
  if (process.platform !== "win32") {
    return p;
  }
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}

/**
 * Normalize a Git Bash path to Windows format.
 * Git Bash returns paths like /c/Users/... which need to be converted to C:\Users\...
 *
 * @param path - The path to normalize
 * @returns The normalized Windows path
 */
export function normalizeGitBashPath(path: string): string {
  if (process.platform === "win32" && path.match(/^\/[a-z]\//)) {
    return path.replace(/^\/([a-z])\//, (_, drive) => `${drive.toUpperCase()}:\\`).replace(/\//g, "\\");
  }
  return path;
}

/**
 * Check if a path is absolute for the current platform.
 *
 * @param p - The path to check
 * @returns True if the path is absolute
 */
export function isAbsolute(p: string): boolean {
  if (process.platform === "win32") {
    return /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
  }
  return p.startsWith("/");
}

/**
 * Resolve a path to absolute form for the current platform.
 *
 * @param p - The path to resolve
 * @param base - The base path (defaults to current working directory)
 * @returns The resolved absolute path
 */
export function resolvePath(p: string, base?: string): string {
  if (isAbsolute(p)) {
    return p;
  }
  return join(base ?? process.cwd(), p);
}

/**
 * Get the relative path between two paths.
 *
 * @param from - The source path
 * @param to - The target path
 * @returns The relative path
 */
export function getRelativePath(from: string, to: string): string {
  return relative(from, to);
}

/**
 * Get the directory name of a path.
 *
 * @param p - The path
 * @returns The directory name
 */
export function getDirname(p: string): string {
  return dirname(p);
}

/**
 * Check if a path is a subpath of another path.
 *
 * @param parent - The parent path
 * @param child - The child path to check
 * @returns True if child is a subpath of parent
 */
export function isSubpath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return !!rel && !rel.startsWith("..") && !rel !== child;
}

/**
 * Check if two paths overlap (share common content).
 *
 * @param a - First path
 * @param b - Second path
 * @returns True if the paths overlap
 */
export function pathsOverlap(a: string, b: string): boolean {
  const relA = relative(a, b);
  const relB = relative(b, a);
  return !relA || !relA.startsWith("..") || !relB || !relB.startsWith("..");
}
