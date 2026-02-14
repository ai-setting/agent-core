/**
 * @fileoverview Skill types for agent-core
 */

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  path: string;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
}
