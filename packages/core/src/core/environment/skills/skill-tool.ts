/**
 * @fileoverview Skill tool for agent-core
 * 
 * Provides a unified tool for executing skills.
 */

import { z } from "zod";
import type { ToolInfo, ToolResult, ToolContext } from "../../types/index.js";
import type { SkillInfo } from "./types.js";

export const baseSkillTool: ToolInfo = {
  name: "skill",
  description: "Execute a skill.",
  parameters: z.object({
    skill: z.string().describe("The skill ID to execute"),
  }),
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const skillId = args.skill as string;
    const env = (ctx as any).env;

    if (!env) {
      return {
        success: false,
        output: "",
        error: "Environment not available",
      };
    }

    const skillInfo = env.getSkill(skillId);
    if (!skillInfo) {
      return {
        success: false,
        output: "",
        error: `Skill not found: ${skillId}. Available skills: ${env.listSkills().map((s: SkillInfo) => s.id).join(", ")}`,
      };
    }

    try {
      const fs = await import("fs/promises");
      const content = await fs.readFile(skillInfo.path, "utf-8");

      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
      const body = bodyMatch ? bodyMatch[1] : content;

      return {
        success: true,
        output: body.trim(),
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        error: `Failed to read skill content: ${error}`,
      };
    }
  },
};

export function createSkillToolWithDescription(skills: SkillInfo[]): ToolInfo {
  const skillsInfo = skills
    .map(s => `- ${s.id} (${s.name}): ${s.description}`)
    .join("\n");

  return {
    ...baseSkillTool,
    description: `Execute a skill. Available skills:\n${skillsInfo}`,
  };
}
