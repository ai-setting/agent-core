/**
 * @fileoverview Skill tool for agent-core
 * 
 * Provides a unified tool for executing skills.
 * Supports both static skill.md content and dynamic JavaScript execution.
 */

import { z } from "zod";
import path from "path";
import type { ToolInfo, ToolResult, ToolContext } from "../../types/index.js";
import type { SkillInfo } from "./types.js";

const SKILL_TOOL_DESCRIPTION = `Load a specialized skill that provides domain-specific instructions and workflows.

When you recognize that a task matches one of the available skills listed below, use this tool to load the full skill instructions.

The skill will inject detailed instructions, workflows, and access to bundled resources (scripts, references, templates) into the conversation context.

The tool output includes the loaded skill content.

The following skills provide specialized sets of instructions for particular tasks
Invoke this tool to load a skill when a task matches one of the available skills listed below:

<available_skills>
{{SKILLS_LIST}}
</available_skills>`;

const SKILL_CONTENT_TEMPLATE = `<skill_content name="{{SKILL_NAME}}">
# Skill: {{SKILL_NAME}}

{{SKILL_CONTENT}}

Base directory for this skill: {{SKILL_DIR}}
Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.

</skill_content>`;

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
      // Return skill.md content as the skill specification
      // Agent should read this and execute any scripts (e.g., index.js) as needed
      const fs = await import("fs/promises");
      const content = await fs.readFile(skillInfo.path, "utf-8");
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
      const output = bodyMatch ? bodyMatch[1] : content;

      const skillDir = path.dirname(skillInfo.path);

      // Wrap output with skill_content block
      const skillContent = SKILL_CONTENT_TEMPLATE
        .replace(/{{SKILL_NAME}}/g, skillInfo.name)
        .replace("{{SKILL_CONTENT}}", output.trim())
        .replace("{{SKILL_DIR}}", skillDir);

      return {
        success: true,
        output: skillContent.trim(),
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        error: `Failed to execute skill: ${error}`,
      };
    }
  },
};

export function createSkillToolWithDescription(skills: SkillInfo[]): ToolInfo {
  let skillsList = "";
  
  if (skills.length === 0) {
    skillsList = "  No skills currently available.";
  } else {
    skillsList = skills
      .map(s => `  <skill>
    <name>${s.id}</name>
    <description>${s.description}</description>
    <location>${s.path}</location>
  </skill>`)
      .join("\n");
  }

  const description = SKILL_TOOL_DESCRIPTION.replace("{{SKILLS_LIST}}", skillsList);

  return {
    ...baseSkillTool,
    description,
  };
}
