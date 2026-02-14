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

interface SkillExecutor {
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

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
      const pathModule = await import("path");
      const skillDir = pathModule.dirname(skillInfo.path);
      const indexPath = pathModule.join(skillDir, "index.js");

      // Check if skill has executable index.js
      try {
        await fs.access(indexPath);
        // Execute the script directly
        const { execSync } = await import("child_process");
        const result = execSync(`bun run "${indexPath}"`, {
          encoding: "utf-8",
          timeout: 30000,
        });
        
        return {
          success: true,
          output: result.trim(),
        };
      } catch (execError) {
        // Check if it's "file not found" or execution error
        if (String(execError).includes("ENOENT")) {
          // No index.js, fall back to returning skill.md content
        } else {
          // Execution failed, try to return skill.md content
          console.warn(`[skillTool] Failed to execute skill ${skillId}:`, execError);
        }
      }

      // Return skill.md content
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
        error: `Failed to execute skill: ${error}`,
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
