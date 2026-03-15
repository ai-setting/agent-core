/**
 * @fileoverview Skill loader for agent-core
 * 
 * Scans the skills directory and parses skill.md files.
 * Supports:
 * - Multi-level subdirectories (recursive scanning)
 * - Case-insensitive skill.md filename (skill.md, SKILL.md, Skill.md, etc.)
 */

import fs from "fs/promises";
import path from "path";
import type { SkillInfo, SkillFrontmatter } from "./types.js";

const SKILL_FILENAME_REGEX = /^skill\.md$/i;

export class SkillLoader {
  private skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  async loadAll(): Promise<SkillInfo[]> {
    const skills: SkillInfo[] = [];

    try {
      await this.scanDirectory(this.skillsDir, skills);
    } catch (error) {
      console.warn(`[SkillLoader] Failed to read skills directory: ${error}`);
    }

    return skills;
  }

  /**
   * Recursively scan directory for skill.md files
   */
  private async scanDirectory(dir: string, skills: SkillInfo[]): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory() || entry.isSymbolicLink()) {
          // Recursively scan subdirectories (including symbolic links)
          await this.scanDirectory(fullPath, skills);
        } else if (entry.isFile() && SKILL_FILENAME_REGEX.test(entry.name)) {
          // Found a skill.md file (case-insensitive)
          const skillInfo = await this.parseSkillFile(fullPath);
          if (skillInfo) {
            skills.push(skillInfo);
          }
        }
      }
    } catch (error) {
      console.warn(`[SkillLoader] Failed to scan directory ${dir}: ${error}`);
    }
  }

  /**
   * Parse skill.md file and extract skill info
   */
  private async parseSkillFile(skillPath: string): Promise<SkillInfo | null> {
    try {
      const content = await fs.readFile(skillPath, "utf-8");
      // Derive skill ID from directory name (parent folder name)
      const skillId = path.basename(path.dirname(skillPath));
      return this.parseSkillMd(content, skillId, skillPath);
    } catch (error) {
      console.warn(`[SkillLoader] Failed to load skill file ${skillPath}: ${error}`);
      return null;
    }
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
