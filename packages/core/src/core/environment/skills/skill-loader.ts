/**
 * @fileoverview Skill loader for agent-core
 * 
 * Scans the skills directory and parses skill.md files.
 */

import fs from "fs/promises";
import path from "path";
import type { SkillInfo, SkillFrontmatter } from "./types.js";

export class SkillLoader {
  private skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  async loadAll(): Promise<SkillInfo[]> {
    const skills: SkillInfo[] = [];

    try {
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillPath = path.join(this.skillsDir, entry.name, "skill.md");
        try {
          const content = await fs.readFile(skillPath, "utf-8");
          const skillInfo = this.parseSkillMd(content, entry.name, skillPath);
          if (skillInfo) {
            skills.push(skillInfo);
          }
        } catch {
          console.warn(`[SkillLoader] Failed to load skill: ${entry.name}`);
        }
      }
    } catch (error) {
      console.warn(`[SkillLoader] Failed to read skills directory: ${error}`);
    }

    return skills;
  }

  private parseSkillMd(content: string, skillId: string, skillPath: string): SkillInfo | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      console.warn(`[SkillLoader] No frontmatter found in ${skillPath}`);
      return null;
    }

    try {
      const frontmatter = this.parseYamlFrontmatter(match[1]);
      if (!frontmatter.name || !frontmatter.description) {
        console.warn(`[SkillLoader] Missing name or description in ${skillPath}`);
        return null;
      }

      return {
        id: skillId,
        name: frontmatter.name,
        description: frontmatter.description,
        path: skillPath,
      };
    } catch (error) {
      console.warn(`[SkillLoader] Failed to parse frontmatter in ${skillPath}: ${error}`);
      return null;
    }
  }

  private parseYamlFrontmatter(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) continue;

      const key = trimmed.substring(0, colonIndex).trim();
      let value = trimmed.substring(colonIndex + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      result[key] = value;
    }

    return result;
  }
}
