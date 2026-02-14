/**
 * @fileoverview Unit tests for SkillLoader
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SkillLoader } from "./skill-loader.js";
import { SkillInfo } from "./types.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("SkillLoader", () => {
  let tempDir: string;
  let skillsDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-loader-test-"));
    skillsDir = path.join(tempDir, "skills");
    await fs.mkdir(skillsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should load no skills from empty directory", async () => {
    const loader = new SkillLoader(skillsDir);
    const skills = await loader.loadAll();
    expect(skills).toEqual([]);
  });

  it("should load skills from valid skill.md files", async () => {
    const skill1Dir = path.join(skillsDir, "skill-one");
    await fs.mkdir(skill1Dir);
    await fs.writeFile(
      path.join(skill1Dir, "skill.md"),
      `---
name: Skill One
description: This is skill one description
---

# Skill One Content

Some content here.`
    );

    const skill2Dir = path.join(skillsDir, "skill-two");
    await fs.mkdir(skill2Dir);
    await fs.writeFile(
      path.join(skill2Dir, "skill.md"),
      `---
name: Skill Two
description: This is skill two description
---

# Skill Two Content`
    );

    const loader = new SkillLoader(skillsDir);
    const skills = await loader.loadAll();

    expect(skills).toHaveLength(2);
    expect(skills.map(s => s.id).sort()).toEqual(["skill-one", "skill-two"]);
    expect(skills.find(s => s.id === "skill-one")?.name).toBe("Skill One");
    expect(skills.find(s => s.id === "skill-one")?.description).toBe("This is skill one description");
  });

  it("should skip directories without skill.md", async () => {
    const skill1Dir = path.join(skillsDir, "valid-skill");
    await fs.mkdir(skill1Dir);
    await fs.writeFile(
      path.join(skill1Dir, "skill.md"),
      `---
name: Valid Skill
description: This is valid
---

# Content`
    );

    const invalidDir = path.join(skillsDir, "invalid-skill");
    await fs.mkdir(invalidDir);
    await fs.writeFile(path.join(invalidDir, "README.md"), "# README");

    const loader = new SkillLoader(skillsDir);
    const skills = await loader.loadAll();

    expect(skills).toHaveLength(1);
    expect(skills[0].id).toBe("valid-skill");
  });

  it("should skip skill.md without valid frontmatter", async () => {
    const skillDir = path.join(skillsDir, "no-frontmatter");
    await fs.mkdir(skillDir);
    await fs.writeFile(
      path.join(skillDir, "skill.md"),
      `# No Frontmatter

Just content.`
    );

    const loader = new SkillLoader(skillsDir);
    const skills = await loader.loadAll();

    expect(skills).toHaveLength(0);
  });

  it("should skip skill.md with missing name or description", async () => {
    const skillDir = path.join(skillsDir, "incomplete");
    await fs.mkdir(skillDir);
    await fs.writeFile(
      path.join(skillDir, "skill.md"),
      `---
name: Only Name
---

# Content`
    );

    const loader = new SkillLoader(skillsDir);
    const skills = await loader.loadAll();

    expect(skills).toHaveLength(0);
  });

  it("should correctly parse skill with special characters in description", async () => {
    const skillDir = path.join(skillsDir, "special-chars");
    await fs.mkdir(skillDir);
    await fs.writeFile(
      path.join(skillDir, "skill.md"),
      `---
name: Special Chars
description: Description with "quotes" and 'single quotes' and :colons:
---

# Content`
    );

    const loader = new SkillLoader(skillsDir);
    const skills = await loader.loadAll();

    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe("Description with \"quotes\" and 'single quotes' and :colons:");
  });

  it("should return correct path for each skill", async () => {
    const skillDir = path.join(skillsDir, "my-skill");
    await fs.mkdir(skillDir);
    await fs.writeFile(
      path.join(skillDir, "skill.md"),
      `---
name: My Skill
description: Test
---

# Content`
    );

    const loader = new SkillLoader(skillsDir);
    const skills = await loader.loadAll();

    expect(skills).toHaveLength(1);
    expect(skills[0].path).toBe(path.join(skillsDir, "my-skill", "skill.md"));
  });

  it("should handle non-directory entries in skills folder", async () => {
    await fs.writeFile(path.join(skillsDir, "README.md"), "# README");
    await fs.writeFile(path.join(skillsDir, ".gitkeep"), "");

    const loader = new SkillLoader(skillsDir);
    const skills = await loader.loadAll();

    expect(skills).toHaveLength(0);
  });
});
