import type { SandboxActionFilterConfig } from "./types.js";

export function matchActionFilter(actionName: string, filter?: SandboxActionFilterConfig): boolean {
  // When no filter is configured, match all actions (sandbox everything)
  if (!filter) {
    return true;
  }

  const { include, exclude } = filter;

  // Check exclude first - if action matches exclude pattern, don't sandbox
  if (exclude && exclude.length > 0) {
    for (const pattern of exclude) {
      if (matchGlob(actionName, pattern)) {
        return false;
      }
    }
  }

  // If include is not set, sandbox everything (except excluded above)
  if (include === undefined) {
    return true;
  }

  // Empty include array means match all (sandbox everything)
  if (include.length === 0) {
    return true;
  }

  // Check if action matches any include pattern
  for (const pattern of include) {
    if (matchGlob(actionName, pattern)) {
      return true;
    }
  }

  return false;
}

function matchGlob(str: string, pattern: string): boolean {
  if (pattern === "*") {
    return true;
  }

  const regexPattern = "^" + pattern
    .replace(/\./g, "\\.")
    .replace(/\*/g, ".*") + "$";

  return new RegExp(regexPattern, "i").test(str);
}
