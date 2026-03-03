import { describe, it, expect } from "bun:test";
import { matchActionFilter } from "./sandbox-action-filter.js";

function matchGlob(str: string, pattern: string): boolean {
  if (pattern === '*') {
    return true
  }
  
  const regexPattern = '^' + pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*') + '$'
  
  return new RegExp(regexPattern, 'i').test(str)
}

describe("Sandbox Action Filter", () => {
  
  describe("include only", () => {
    it("should match action when include is empty (default all)", () => {
      expect(matchActionFilter("bash", { include: [] })).toBe(true)
      expect(matchActionFilter("any_action", { include: [] })).toBe(true)
    })
    
    it("should match action in include list", () => {
      expect(matchActionFilter("bash", { include: ["bash", "file_read"] })).toBe(true)
      expect(matchActionFilter("file_read", { include: ["bash", "file_read"] })).toBe(true)
    })
    
    it("should not match action not in include list", () => {
      expect(matchActionFilter("http_fetch", { include: ["bash", "file_read"] })).toBe(false)
    })
  })
  
  describe("wildcard matching", () => {
    it("should match wildcard *", () => {
      expect(matchActionFilter("mcp_filesystem_read", { include: ["mcp_*"] })).toBe(true)
      expect(matchActionFilter("mcp_github_push", { include: ["mcp_*"] })).toBe(true)
    })
    
    it("should match multiple wildcards", () => {
      expect(matchActionFilter("bash", { include: ["bash", "mcp_*", "file_*"] })).toBe(true)
      expect(matchActionFilter("mcp_github", { include: ["bash", "mcp_*", "file_*"] })).toBe(true)
      expect(matchActionFilter("file_write", { include: ["bash", "mcp_*", "file_*"] })).toBe(true)
      expect(matchActionFilter("http_fetch", { include: ["bash", "mcp_*", "file_*"] })).toBe(false)
    })
    
    it("should handle star pattern anywhere in string", () => {
      expect(matchActionFilter("safe_bash_tool", { include: ["*_bash_*"] })).toBe(true)
      expect(matchActionFilter("bash_tool_safe", { include: ["bash_*"] })).toBe(true)
      expect(matchActionFilter("prefix_bash", { include: ["*_bash"] })).toBe(true)
    })
  })
  
  describe("exclude only", () => {
    it("should exclude specific actions when only exclude is set", () => {
      // Without include, exclude filters out specific actions but everything else matches
      expect(matchActionFilter("bash_readonly", { exclude: ["bash_readonly"] })).toBe(false)
      expect(matchActionFilter("bash", { exclude: ["bash_readonly"] })).toBe(true)
    })
    
    it("should exclude by wildcard pattern when only exclude is set", () => {
      expect(matchActionFilter("mcp_safe_read", { exclude: ["mcp_safe_*"] })).toBe(false)
      expect(matchActionFilter("mcp_dangerous_write", { exclude: ["mcp_safe_*"] })).toBe(true)
    })
    
    it("should exclude by wildcard pattern when only exclude is set", () => {
      expect(matchActionFilter("mcp_safe_read", { exclude: ["mcp_safe_*"] })).toBe(false)
      // mcp_dangerous_write doesn't match the exclude pattern, so it returns true
      expect(matchActionFilter("mcp_dangerous_write", { exclude: ["mcp_safe_*"] })).toBe(true)
    })
    
    it("should work with include and exclude", () => {
      const filter = {
        include: ["bash", "mcp_*"],
        exclude: ["mcp_safe"]
      }
      
      expect(matchActionFilter("bash", filter)).toBe(true)
      expect(matchActionFilter("mcp_filesystem", filter)).toBe(true)
      expect(matchActionFilter("mcp_safe", filter)).toBe(false)
    })
    
    it("should exclude override include", () => {
      const filter = {
        include: ["bash", "mcp_*"],
        exclude: ["mcp_*_read"]
      }
      
      expect(matchActionFilter("bash", filter)).toBe(true)
      expect(matchActionFilter("mcp_filesystem_write", filter)).toBe(true)
      expect(matchActionFilter("mcp_github_read", filter)).toBe(false)
    })
  })
  
  describe("no filter config", () => {
    it("should match all actions when filter is undefined (sandbox everything)", () => {
      expect(matchActionFilter("bash", undefined)).toBe(true)
      expect(matchActionFilter("any_action", undefined)).toBe(true)
    })
    
    it("should match all actions when filter is empty object", () => {
      expect(matchActionFilter("bash", {})).toBe(true)
      expect(matchActionFilter("any_action", {})).toBe(true)
    })
    
    it("should match all actions when include is undefined (no explicit include)", () => {
      expect(matchActionFilter("bash", { exclude: ["mcp_safe"] })).toBe(true)
      expect(matchActionFilter("mcp_safe", { exclude: ["mcp_safe"] })).toBe(false)
    })
    
    it("should return true when include is empty array", () => {
      expect(matchActionFilter("bash", { include: [], exclude: [] })).toBe(true)
    })
  })
  
  describe("edge cases", () => {
    it("should handle exact match", () => {
      expect(matchActionFilter("bash", { include: ["bash"] })).toBe(true)
      expect(matchActionFilter("bashh", { include: ["bash"] })).toBe(false)
    })
    
    it("should handle case insensitive matching", () => {
      expect(matchActionFilter("BASH", { include: ["bash"] })).toBe(true)
      expect(matchActionFilter("bash", { include: ["BASH"] })).toBe(true)
    })
    
    it("should handle dot in action name", () => {
      expect(matchActionFilter("tool.name", { include: ["tool.name"] })).toBe(true)
      expect(matchActionFilter("tool_name", { include: ["tool.name"] })).toBe(false)
    })
    
    it("should handle multiple wildcards in pattern", () => {
      expect(matchActionFilter("a_b_c", { include: ["a_*_c"] })).toBe(true)
      expect(matchActionFilter("abc", { include: ["a_*_c"] })).toBe(false)
    })
  })
})
