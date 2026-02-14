/**
 * @fileoverview Integration tests for Skill mechanism in BaseEnvironment
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { BaseEnvironment } from "../base/base-environment.js";
import type { SkillInfo } from "./types.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

class TestEnvWithSkills extends BaseEnvironment {
  private skillsDir: string | undefined;

  constructor(skillsDir?: string) {
    super({});
    this.skillsDir = skillsDir;
  }

  protected getDefaultTimeout(): number {
    return 1000;
  }
  protected getTimeoutOverride(): number | undefined {
    return undefined;
  }
  protected getMaxRetries(): number {
    return 0;
  }
  protected getRetryDelay(): number {
    return 0;
  }
  protected isRetryableError(): boolean {
    return false;
  }
  protected getConcurrencyLimit(): number {
    return 1;
  }
  protected getRecoveryStrategy(): {
    type: "retry" | "fallback" | "skip" | "error";
    maxRetries?: number;
    fallbackTool?: string;
  } {
    return { type: "error" };
  }
  protected getSkillsDirectory(): string | undefined {
    return this.skillsDir;
  }

  setSkillsDir(dir: string | undefined) {
    this.skillsDir = dir;
  }
}

describe("BaseEnvironment Skill integration", () => {
  let tempDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-integration-test-"));
    skillsDir = path.join(tempDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("listSkills", () => {
    it("should return empty array when no skills loaded", async () => {
      const env = new TestEnvWithSkills();
      const skills = env.listSkills();
      expect(skills).toEqual([]);
    });

    it("should return loaded skills after loadSkills", async () => {
      const skillDir = path.join(skillsDir, "test-skill");
      await fs.mkdir(skillDir);
      await fs.writeFile(
        path.join(skillDir, "skill.md"),
        `---
name: Test Skill
description: A test skill
---

# Content`
      );

      const env = new TestEnvWithSkills(skillsDir);
      await env.loadSkills();

      const skills = env.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe("test-skill");
      expect(skills[0].name).toBe("Test Skill");
    });
  });

  describe("getSkill", () => {
    it("should return undefined for non-existent skill", async () => {
      const env = new TestEnvWithSkills(skillsDir);
      await env.loadSkills();

      const skill = env.getSkill("non-existent");
      expect(skill).toBeUndefined();
    });

    it("should return skill by id", async () => {
      const skillDir = path.join(skillsDir, "my-skill");
      await fs.mkdir(skillDir);
      await fs.writeFile(
        path.join(skillDir, "skill.md"),
        `---
name: My Skill
description: My description
---

# Content`
      );

      const env = new TestEnvWithSkills(skillsDir);
      await env.loadSkills();

      const skill = env.getSkill("my-skill");
      expect(skill).toBeDefined();
      expect(skill?.name).toBe("My Skill");
      expect(skill?.description).toBe("My description");
    });
  });

  describe("getSkillsInfoForToolDescription", () => {
    it("should return empty string when no skills", () => {
      const env = new TestEnvWithSkills();
      const info = env.getSkillsInfoForToolDescription();
      expect(info).toBe("");
    });

    it("should return formatted skill info", async () => {
      const skillDir = path.join(skillsDir, "skill-a");
      await fs.mkdir(skillDir);
      await fs.writeFile(
        path.join(skillDir, "skill.md"),
        `---
name: Skill A
description: Description A
---

# Content`
      );

      const env = new TestEnvWithSkills(skillsDir);
      await env.loadSkills();

      const info = env.getSkillsInfoForToolDescription();
      expect(info).toContain("- Skill A: Description A");
    });
  });

  describe("loadSkills", () => {
    it("should handle no skills directory", async () => {
      const env = new TestEnvWithSkills(undefined);
      await env.loadSkills();

      const skills = env.listSkills();
      expect(skills).toEqual([]);
    });

    it("should reload skills when called multiple times", async () => {
      const skillDir1 = path.join(skillsDir, "skill-1");
      await fs.mkdir(skillDir1);
      await fs.writeFile(
        path.join(skillDir1, "skill.md"),
        `---
name: Skill 1
description: First skill
---

# Content`
      );

      const env = new TestEnvWithSkills(skillsDir);
      await env.loadSkills();

      expect(env.listSkills()).toHaveLength(1);

      const skillDir2 = path.join(skillsDir, "skill-2");
      await fs.mkdir(skillDir2);
      await fs.writeFile(
        path.join(skillDir2, "skill.md"),
        `---
name: Skill 2
description: Second skill
---

# Content`
      );

      await env.loadSkills();

      const skills = env.listSkills();
      expect(skills).toHaveLength(2);
    });

    it("should register skill tool after loading", async () => {
      const skillDir = path.join(skillsDir, "test-skill");
      await fs.mkdir(skillDir);
      await fs.writeFile(
        path.join(skillDir, "skill.md"),
        `---
name: Test Skill
description: A test skill
---

# Content`
      );

      const env = new TestEnvWithSkills(skillsDir);
      await env.loadSkills();

      const tools = env.getTools();
      const skillTool = tools.find(t => t.name === "skill");
      expect(skillTool).toBeDefined();
      expect(skillTool?.description).toContain("A test skill");
    });
  });

  describe("skill tool execution", () => {
    it("should execute skill and return content", async () => {
      const skillDir = path.join(skillsDir, "exec-skill");
      await fs.mkdir(skillDir);
      await fs.writeFile(
        path.join(skillDir, "skill.md"),
        `---
name: Exec Skill
description: Execution test
---

# This is skill content

Some detailed content here.`
      );

      const env = new TestEnvWithSkills(skillsDir);
      await env.loadSkills();

      const tools = env.getTools();
      const skillTool = tools.find(t => t.name === "skill");
      expect(skillTool).toBeDefined();

      const result = await skillTool!.execute({ skill: "exec-skill" }, { env } as any);

      expect(result.success).toBe(true);
      expect(result.output).toContain("This is skill content");
      expect(result.output).not.toContain("---");
    });

    it("should return error for non-existent skill", async () => {
      const skillDir = path.join(skillsDir, "existing-skill");
      await fs.mkdir(skillDir);
      await fs.writeFile(
        path.join(skillDir, "skill.md"),
        `---
name: Existing Skill
description: Existing description
---

# Content`
      );

      const env = new TestEnvWithSkills(skillsDir);
      await env.loadSkills();

      const tools = env.getTools();
      const skillTool = tools.find(t => t.name === "skill");
      expect(skillTool).toBeDefined();

      const result = await skillTool!.execute({ skill: "non-existent" }, { env } as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Skill not found");
    });
  });
});
