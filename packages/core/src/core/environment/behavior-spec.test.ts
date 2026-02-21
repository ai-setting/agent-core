import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs/promises";
import path from "path";
import { tmpdir } from "os";
import { BaseEnvironment } from "./base/base-environment.js";
import type { BehaviorSpec, EnvironmentAgentSpec, EnvironmentProfile } from "./index.js";
import type { Tool } from "../types/index.js";

class TestEnvironment extends BaseEnvironment {
  private testEnvName: string;
  private testRulesPath: string | undefined;
  private testPromptsPath: string | undefined;
  private testAgentSpecs: Map<string, EnvironmentAgentSpec> = new Map();

  constructor(config: {
    envName?: string;
    rulesPath?: string;
    promptsPath?: string;
    agentSpecs?: EnvironmentAgentSpec[];
  } = {}) {
    super();
    this.testEnvName = config.envName || "test";
    this.testRulesPath = config.rulesPath;
    this.testPromptsPath = config.promptsPath;
    
    if (config.agentSpecs) {
      for (const spec of config.agentSpecs) {
        this.testAgentSpecs.set(spec.id, spec);
      }
    }
  }

  protected getEnvName(): string {
    return this.testEnvName;
  }

  protected getRulesFilePath(): string | undefined {
    return this.testRulesPath;
  }

  protected getPromptsDirectory(): string | undefined {
    return this.testPromptsPath;
  }

  override getProfiles(): EnvironmentProfile[] {
    const specs = Array.from(this.testAgentSpecs.values());
    return [
      {
        id: "test-profile",
        displayName: "Test Profile",
        primaryAgents: specs.filter((s) => s.role === "primary"),
        subAgents: specs.filter((s) => s.role === "sub"),
      },
    ];
  }

  protected getDefaultTimeout(_toolName: string): number {
    return 30000;
  }
  protected getTimeoutOverride(_action: unknown): number | undefined {
    return undefined;
  }
  protected getMaxRetries(_toolName: string): number {
    return 3;
  }
  protected getRetryDelay(_toolName: string): number {
    return 1000;
  }
  protected isRetryableError(_error: string): boolean {
    return false;
  }
  protected getConcurrencyLimit(_toolName: string): number {
    return 5;
  }
  protected getRecoveryStrategy(_toolName: string): {
    type: "retry" | "fallback" | "skip" | "error";
    maxRetries?: number;
    fallbackTool?: string;
  } {
    return { type: "retry", maxRetries: 3 };
  }
  protected getSkillsDirectory(): string | undefined {
    return undefined;
  }
}

describe("BehaviorSpec", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "behavior-spec-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("getBehaviorSpec", () => {
    it("should return default behavior spec when no rules.md exists", async () => {
      const env = new TestEnvironment({ envName: "default" });
      const spec = await env.getBehaviorSpec!("system");

      expect(spec.envName).toBe("default");
      expect(spec.agentId).toBe("system");
      expect(spec.agentRole).toBe("primary");
      expect(spec.envRules).toContain("Default Environment Guidelines");
      expect(spec.agentPrompt).toBe("");
      expect(spec.combinedPrompt).toContain("Environment: default");
      expect(spec.combinedPrompt).toContain("Agent: system");
    });

    it("should load env rules from rules.md", async () => {
      const rulesPath = path.join(tempDir, "rules.md");
      const rulesContent = `# Test Environment Rules

## Safety
- Never expose secrets
- Validate inputs

## Communication
- Be concise
- Explain reasoning`;
      
      await fs.writeFile(rulesPath, rulesContent);

      const env = new TestEnvironment({
        envName: "test",
        rulesPath,
      });

      const spec = await env.getBehaviorSpec!("system");

      expect(spec.envRules).toBe(rulesContent);
      expect(spec.combinedPrompt).toContain("Test Environment Rules");
    });

    it("should load agent prompt from prompts directory", async () => {
      const promptsDir = path.join(tempDir, "prompts");
      await fs.mkdir(promptsDir);

      const systemPrompt = `---
id: system
role: system
---

# System Agent

You are the primary system agent.`;
      
      await fs.writeFile(path.join(promptsDir, "system.prompt"), systemPrompt);

      const env = new TestEnvironment({
        envName: "test",
        promptsPath: promptsDir,
      });

      const spec = await env.getBehaviorSpec!("system");

      expect(spec.agentPrompt).toContain("System Agent");
      expect(spec.agentPrompt).toContain("primary system agent");
    });

    it("should combine env rules and agent prompt", async () => {
      const rulesPath = path.join(tempDir, "rules.md");
      const promptsDir = path.join(tempDir, "prompts");
      await fs.mkdir(promptsDir);

      await fs.writeFile(rulesPath, `# Env Rules\n\nShared rules here.`);
      await fs.writeFile(
        path.join(promptsDir, "coder.prompt"),
        `---
id: coder
---

# Coder Agent

You are a coding assistant.`
      );

      const env = new TestEnvironment({
        envName: "coding",
        rulesPath,
        promptsPath: promptsDir,
      });

      const spec = await env.getBehaviorSpec!("coder");

      expect(spec.envRules).toBe("# Env Rules\n\nShared rules here.");
      expect(spec.agentPrompt).toContain("Coder Agent");
      expect(spec.combinedPrompt).toContain("Environment: coding");
      expect(spec.combinedPrompt).toContain("Agent: coder");
      expect(spec.combinedPrompt).toContain("Env Rules");
      expect(spec.combinedPrompt).toContain("Coder Agent");
    });

    it("should include allowedTools from agent spec", async () => {
      const env = new TestEnvironment({
        envName: "test",
        agentSpecs: [
          {
            id: "reviewer",
            role: "sub",
            allowedTools: ["read", "grep", "glob"],
          },
        ],
      });

      const spec = await env.getBehaviorSpec!("reviewer");

      expect(spec.agentId).toBe("reviewer");
      expect(spec.agentRole).toBe("sub");
      expect(spec.allowedTools).toEqual(["read", "grep", "glob"]);
    });

    it("should include deniedTools from agent spec", async () => {
      const env = new TestEnvironment({
        envName: "test",
        agentSpecs: [
          {
            id: "readonly",
            role: "sub",
            deniedTools: ["write", "bash"],
          },
        ],
      });

      const spec = await env.getBehaviorSpec!("readonly");

      expect(spec.deniedTools).toEqual(["write", "bash"]);
    });

    it("should use promptOverride when provided", async () => {
      const env = new TestEnvironment({
        envName: "test",
        agentSpecs: [
          {
            id: "custom",
            role: "primary",
            promptOverride: "Custom override prompt",
          },
        ],
      });

      const spec = await env.getBehaviorSpec!("custom");

      expect(spec.agentPrompt).toBe("Custom override prompt");
    });
  });

  describe("getEnvRules", () => {
    it("should return only environment rules", async () => {
      const rulesPath = path.join(tempDir, "rules.md");
      const rulesContent = "# Env Rules Only";
      await fs.writeFile(rulesPath, rulesContent);

      const env = new TestEnvironment({
        envName: "test",
        rulesPath,
      });

      const envRules = await env.getEnvRules!();

      expect(envRules).toBe(rulesContent);
    });
  });

  describe("refreshBehaviorSpec", () => {
    it("should reload rules from file", async () => {
      const rulesPath = path.join(tempDir, "rules.md");
      await fs.writeFile(rulesPath, "Original rules");

      const env = new TestEnvironment({
        envName: "test",
        rulesPath,
      });

      const spec1 = await env.getBehaviorSpec!("system");
      expect(spec1.envRules).toBe("Original rules");

      await fs.writeFile(rulesPath, "Updated rules");
      await env.refreshBehaviorSpec!();

      const spec2 = await env.getBehaviorSpec!("system");
      expect(spec2.envRules).toBe("Updated rules");
    });
  });

  describe("filterToolsByPermission", () => {
    const mockTools: Tool[] = [
      { name: "read", description: "Read file", parameters: {} as any, execute: async () => ({ success: true, output: "" }) },
      { name: "write", description: "Write file", parameters: {} as any, execute: async () => ({ success: true, output: "" }) },
      { name: "bash", description: "Run command", parameters: {} as any, execute: async () => ({ success: true, output: "" }) },
      { name: "grep", description: "Search", parameters: {} as any, execute: async () => ({ success: true, output: "" }) },
    ];

    it("should filter by allowedTools", async () => {
      const env = new TestEnvironment({
        envName: "test",
        agentSpecs: [
          {
            id: "readonly",
            role: "sub",
            allowedTools: ["read", "grep"],
          },
        ],
      });

      // 先加载行为规范（会加载 agentSpecs）
      await env.getBehaviorSpec!("readonly");
      const filtered = env.filterToolsByPermission!(mockTools, "readonly");

      expect(filtered.map((t) => t.name)).toEqual(["read", "grep"]);
    });

    it("should filter by deniedTools", async () => {
      const env = new TestEnvironment({
        envName: "test",
        agentSpecs: [
          {
            id: "nowrite",
            role: "sub",
            deniedTools: ["write", "bash"],
          },
        ],
      });

      // 先加载行为规范（会加载 agentSpecs）
      await env.getBehaviorSpec!("nowrite");
      const filtered = env.filterToolsByPermission!(mockTools, "nowrite");

      expect(filtered.map((t) => t.name)).toEqual(["read", "grep"]);
    });

    it("should return all tools when no restrictions", async () => {
      const env = new TestEnvironment({ envName: "test" });

      await env.getBehaviorSpec!("system");
      const filtered = env.filterToolsByPermission!(mockTools, "system");

      expect(filtered.map((t) => t.name)).toEqual(["read", "write", "bash", "grep"]);
    });

    it("should return all tools for unknown agent", async () => {
      const env = new TestEnvironment({ envName: "test" });

      await env.getBehaviorSpec!("unknown");
      const filtered = env.filterToolsByPermission!(mockTools, "unknown");

      expect(filtered.map((t) => t.name)).toEqual(["read", "write", "bash", "grep"]);
    });
  });

  describe("combinedPrompt format", () => {
    it("should include environment info header", async () => {
      const env = new TestEnvironment({ envName: "coding" });
      const spec = await env.getBehaviorSpec!("coder");

      expect(spec.combinedPrompt).toContain("Environment: coding");
      expect(spec.combinedPrompt).toContain("Agent: coder");
      expect(spec.combinedPrompt).toContain("Working directory:");
      expect(spec.combinedPrompt).toContain("Today:");
    });

    it("should separate sections with ---", async () => {
      const rulesPath = path.join(tempDir, "rules.md");
      const promptsDir = path.join(tempDir, "prompts");
      await fs.mkdir(promptsDir);

      await fs.writeFile(rulesPath, "Env rules");
      await fs.writeFile(path.join(promptsDir, "system.prompt"), "Agent prompt");

      const env = new TestEnvironment({
        envName: "test",
        rulesPath,
        promptsPath: promptsDir,
      });

      const spec = await env.getBehaviorSpec!("system");

      const sections = spec.combinedPrompt.split("---");
      expect(sections.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("system prompt injection verification", () => {
    it("should inject rules.md content into combinedPrompt", async () => {
      const rulesPath = path.join(tempDir, "rules.md");
      const rulesContent = `# ZST Environment Rules

## Safety Rules
- Never expose API keys
- Confirm before destructive operations

## Communication
- Be concise
- Explain reasoning`;
      
      await fs.writeFile(rulesPath, rulesContent);

      const env = new TestEnvironment({
        envName: "zst",
        rulesPath,
      });

      const spec = await env.getBehaviorSpec!("system");

      // 验证 rules.md 内容被注入
      expect(spec.combinedPrompt).toContain("ZST Environment Rules");
      expect(spec.combinedPrompt).toContain("Never expose API keys");
      expect(spec.combinedPrompt).toContain("Confirm before destructive operations");
      expect(spec.combinedPrompt).toContain("Be concise");
      expect(spec.combinedPrompt).toContain("Explain reasoning");
    });

    it("should inject both rules.md and agent prompt into combinedPrompt", async () => {
      const rulesPath = path.join(tempDir, "rules.md");
      const promptsDir = path.join(tempDir, "prompts");
      await fs.mkdir(promptsDir);

      const rulesContent = `# Env Rules
- Rule 1
- Rule 2`;
      const agentPromptContent = `# Agent Prompt
You are a helpful assistant.`;

      await fs.writeFile(rulesPath, rulesContent);
      await fs.writeFile(path.join(promptsDir, "system.prompt"), agentPromptContent);

      const env = new TestEnvironment({
        envName: "test",
        rulesPath,
        promptsPath: promptsDir,
      });

      const spec = await env.getBehaviorSpec!("system");

      // 验证两部分都被注入
      expect(spec.combinedPrompt).toContain("Env Rules");
      expect(spec.combinedPrompt).toContain("Rule 1");
      expect(spec.combinedPrompt).toContain("Rule 2");
      expect(spec.combinedPrompt).toContain("Agent Prompt");
      expect(spec.combinedPrompt).toContain("You are a helpful assistant");
    });

    it("should have correct structure in combinedPrompt", async () => {
      const rulesPath = path.join(tempDir, "rules.md");
      const promptsDir = path.join(tempDir, "prompts");
      await fs.mkdir(promptsDir);

      await fs.writeFile(rulesPath, "# My Rules\n\nRule content here.");
      await fs.writeFile(path.join(promptsDir, "system.prompt"), "# My Agent\n\nAgent content here.");

      const env = new TestEnvironment({
        envName: "production",
        rulesPath,
        promptsPath: promptsDir,
      });

      const spec = await env.getBehaviorSpec!("system");

      // 验证结构顺序：header -> env rules -> agent prompt
      const lines = spec.combinedPrompt.split("\n");
      
      // 找到各部分的位置
      const envHeaderIndex = lines.findIndex(l => l.includes("Environment: production"));
      const envRulesIndex = lines.findIndex(l => l.includes("My Rules"));
      const agentPromptIndex = lines.findIndex(l => l.includes("My Agent"));
      
      // 验证顺序正确
      expect(envHeaderIndex).toBeLessThan(envRulesIndex);
      expect(envRulesIndex).toBeLessThan(agentPromptIndex);
    });

    it("should use promptOverride instead of prompt file when both exist", async () => {
      const rulesPath = path.join(tempDir, "rules.md");
      const promptsDir = path.join(tempDir, "prompts");
      await fs.mkdir(promptsDir);

      await fs.writeFile(rulesPath, "# Env Rules");
      await fs.writeFile(path.join(promptsDir, "custom.prompt"), "This should be ignored");

      const env = new TestEnvironment({
        envName: "test",
        rulesPath,
        promptsPath: promptsDir,
        agentSpecs: [
          {
            id: "custom",
            role: "primary",
            promptOverride: "This is the override prompt",
          },
        ],
      });

      const spec = await env.getBehaviorSpec!("custom");

      // promptOverride 应该覆盖 prompt 文件
      expect(spec.agentPrompt).toBe("This is the override prompt");
      expect(spec.agentPrompt).not.toContain("This should be ignored");
      // env rules 仍然应该存在
      expect(spec.combinedPrompt).toContain("Env Rules");
    });
  });
});
