/**
 * @fileoverview Unit tests for skill-tool
 */

import { describe, it, expect, beforeEach, afterEach, jest } from "bun:test";
import { baseSkillTool, createSkillToolWithDescription } from "./skill-tool.js";
import type { SkillInfo } from "./types.js";

describe("skill-tool", () => {
  describe("createSkillToolWithDescription", () => {
    it("should create skill tool with correct format", () => {
      const skills: SkillInfo[] = [
        {
          id: "test-skill",
          name: "Test Skill",
          description: "A test skill description",
          path: "/path/to/skill.md",
        },
      ];

      const tool = createSkillToolWithDescription(skills);

      expect(tool.name).toBe("skill");
      expect(tool.description).toContain("test-skill (Test Skill): A test skill description");
      expect(tool.description).toContain("Execute a skill. Available skills:");
    });

    it("should list multiple skills in description", () => {
      const skills: SkillInfo[] = [
        {
          id: "skill-one",
          name: "Skill One",
          description: "First skill",
          path: "/path/one.md",
        },
        {
          id: "skill-two",
          name: "Skill Two",
          description: "Second skill",
          path: "/path/two.md",
        },
      ];

      const tool = createSkillToolWithDescription(skills);

      expect(tool.description).toContain("skill-one (Skill One): First skill");
      expect(tool.description).toContain("skill-two (Skill Two): Second skill");
    });

    it("should handle empty skills array", () => {
      const tool = createSkillToolWithDescription([]);

      expect(tool.description).toBe("Execute a skill. Available skills:\n");
    });

    it("should preserve baseSkillTool structure", () => {
      const skills: SkillInfo[] = [
        {
          id: "test",
          name: "Test",
          description: "Test desc",
          path: "/test.md",
        },
      ];

      const tool = createSkillToolWithDescription(skills);

      expect(tool.parameters).toBe(baseSkillTool.parameters);
      expect(typeof tool.execute).toBe("function");
    });
  });

  describe("baseSkillTool", () => {
    it("should have correct name", () => {
      expect(baseSkillTool.name).toBe("skill");
    });

    it("should have execute function", () => {
      expect(typeof baseSkillTool.execute).toBe("function");
    });

    it("should have parameters schema", () => {
      expect(baseSkillTool.parameters).toBeDefined();
    });
  });
});
