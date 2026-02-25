/**
 * @fileoverview Unit tests for SubAgent specifications and permissions.
 */

import { describe, test, expect } from "bun:test";
import {
  builtInSubAgents,
  getSubAgentSpec,
  listSubAgents,
  getSubAgentToolDescription,
} from "./agents.js";
import {
  buildSubAgentPermissions,
  getDefaultSubAgentPrompt,
} from "./permissions.js";

describe("SubAgent - Agents Specification", () => {
  test("should have built-in general subagent", () => {
    const general = getSubAgentSpec("general");
    expect(general).toBeDefined();
    expect(general?.id).toBe("general");
    expect(general?.mode).toBe("subagent");
    expect(general?.promptOverride).toContain("subagent");
    expect(general?.promptOverride).toContain("{task_description}");
  });

  test("should have built-in explore subagent", () => {
    const explore = getSubAgentSpec("explore");
    expect(explore).toBeDefined();
    expect(explore?.id).toBe("explore");
    expect(explore?.mode).toBe("subagent");
  });

  test("should return undefined for unknown subagent", () => {
    const unknown = getSubAgentSpec("unknown");
    expect(unknown).toBeUndefined();
  });

  test("should list all subagents", () => {
    const agents = listSubAgents();
    expect(agents.length).toBeGreaterThanOrEqual(2);
    expect(agents.find(a => a.id === "general")).toBeDefined();
    expect(agents.find(a => a.id === "explore")).toBeDefined();
  });

  test("should generate tool description", () => {
    const desc = getSubAgentToolDescription();
    expect(desc).toContain("- general:");
    expect(desc).toContain("- explore:");
  });
});

describe("SubAgent - Permissions", () => {
  test("should deny todowrite by default", () => {
    const permissions = buildSubAgentPermissions(undefined);
    const todowrite = permissions.find(p => p.permission === "todowrite");
    expect(todowrite).toBeDefined();
    expect(todowrite?.action).toBe("deny");
    expect(todowrite?.pattern).toBe("*");
  });

  test("should deny toread by default", () => {
    const permissions = buildSubAgentPermissions(undefined);
    const toread = permissions.find(p => p.permission === "todoread");
    expect(toread).toBeDefined();
    expect(toread?.action).toBe("deny");
  });

  test("should deny task by default (prevent subagent creating subagent)", () => {
    const permissions = buildSubAgentPermissions(undefined);
    const task = permissions.find(p => p.permission === "task");
    expect(task).toBeDefined();
    expect(task?.action).toBe("deny");
  });

  test("should apply allowedTools whitelist", () => {
    const subAgent = {
      id: "test",
      name: "test",
      description: "test",
      mode: "subagent" as const,
      allowedTools: ["bash", "read"],
    };
    const permissions = buildSubAgentPermissions(subAgent);
    
    const denyAll = permissions.find(p => p.permission === "*" && p.action === "deny");
    expect(denyAll).toBeDefined();
    
    const allowBash = permissions.find(p => p.permission === "tool" && p.pattern === "bash" && p.action === "allow");
    expect(allowBash).toBeDefined();
    
    const allowRead = permissions.find(p => p.permission === "tool" && p.pattern === "read" && p.action === "allow");
    expect(allowRead).toBeDefined();
  });

  test("should apply deniedTools blacklist", () => {
    const subAgent = {
      id: "test",
      name: "test",
      description: "test",
      mode: "subagent" as const,
      deniedTools: ["delete", "write"],
    };
    const permissions = buildSubAgentPermissions(subAgent);
    
    const denyDelete = permissions.find(p => p.permission === "tool" && p.pattern === "delete" && p.action === "deny");
    expect(denyDelete).toBeDefined();
    
    const denyWrite = permissions.find(p => p.permission === "tool" && p.pattern === "write" && p.action === "deny");
    expect(denyWrite).toBeDefined();
  });

  test("should merge extra permissions", () => {
    const permissions = buildSubAgentPermissions(undefined, {
      extraPermissions: [
        { permission: "custom", pattern: "test", action: "allow" },
      ],
    });
    
    const custom = permissions.find(p => p.permission === "custom" && p.pattern === "test");
    expect(custom).toBeDefined();
    expect(custom?.action).toBe("allow");
  });

  test("should generate default prompt with task description", () => {
    const prompt = getDefaultSubAgentPrompt("my task");
    expect(prompt).toContain("my task");
    expect(prompt).toContain("subagent");
    expect(prompt).toContain("Your Role");
  });
});

describe("SubAgent - Explore Agent Configuration", () => {
  test("should have explore subagent with required tools", () => {
    const explore = getSubAgentSpec("explore");
    expect(explore).toBeDefined();
    expect(explore?.allowedTools).toBeDefined();
    expect(explore?.allowedTools?.length).toBeGreaterThan(0);
  });

  test("explore subagent should have read and search tools", () => {
    const explore = getSubAgentSpec("explore");
    expect(explore?.allowedTools).toContain("read");
    expect(explore?.allowedTools).toContain("grep");
    expect(explore?.allowedTools).toContain("glob");
    expect(explore?.allowedTools).toContain("bash");
  });

  test("explore subagent should have read-only tools (no write)", () => {
    const explore = getSubAgentSpec("explore");
    expect(explore?.allowedTools).toContain("glob");
    expect(explore?.allowedTools).toContain("grep");
    expect(explore?.allowedTools).toContain("read");
    expect(explore?.allowedTools).toContain("bash");
    expect(explore?.allowedTools).not.toContain("write");
  });
});

describe("SubAgent - System Prompt Replacement", () => {
  test("should replace task_description placeholder in general subagent", () => {
    const general = getSubAgentSpec("general");
    expect(general?.promptOverride).toContain("{task_description}");
    
    const replaced = general?.promptOverride?.replace(/\{task_description\}/g, "search code");
    expect(replaced).toContain("search code");
    expect(replaced).not.toContain("{task_description}");
  });

  test("should replace task_description placeholder in explore subagent", () => {
    const explore = getSubAgentSpec("explore");
    expect(explore?.promptOverride).toContain("{task_description}");
    
    const replaced = explore?.promptOverride?.replace(/\{task_description\}/g, "find files");
    expect(replaced).toContain("find files");
    expect(replaced).not.toContain("{task_description}");
  });
});
