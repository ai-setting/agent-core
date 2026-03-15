/**
 * @fileoverview Unit tests for SkillLoader
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SkillLoader } from "./skill-loader.js";
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

  describe("multi-level subdirectory support", () => {
    it("should load skills from nested subdirectories", async () => {
      const nestedDir = path.join(skillsDir, "level1", "level2", "nested-skill");
      await fs.mkdir(nestedDir, { recursive: true });
      await fs.writeFile(
        path.join(nestedDir, "skill.md"),
        `---
name: Nested Skill
description: A skill in a nested directory
---

# Content`
      );

      const loader = new SkillLoader(skillsDir);
      const skills = await loader.loadAll();

      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe("nested-skill");
      expect(skills[0].name).toBe("Nested Skill");
    });

    it("should load skills from multiple nested levels", async () => {
      const deepDir = path.join(skillsDir, "a", "b", "c", "deep-skill");
      await fs.mkdir(deepDir, { recursive: true });
      await fs.writeFile(
        path.join(deepDir, "skill.md"),
        `---
name: Deep Skill
description: A deeply nested skill
---

# Content`
      );

      const shallowDir = path.join(skillsDir, "shallow-skill");
      await fs.mkdir(shallowDir);
      await fs.writeFile(
        path.join(shallowDir, "skill.md"),
        `---
name: Shallow Skill
description: A shallow skill
---

# Content`
      );

      const loader = new SkillLoader(skillsDir);
      const skills = await loader.loadAll();

      expect(skills).toHaveLength(2);
      const ids = skills.map(s => s.id).sort();
      expect(ids).toEqual(["deep-skill", "shallow-skill"]);
    });

    it("should load multiple skills from different nested paths", async () => {
      const dir1 = path.join(skillsDir, "category1", "sub1", "skill-a");
      const dir2 = path.join(skillsDir, "category2", "skill-b");
      const dir3 = path.join(skillsDir, "skill-c");

      await fs.mkdir(dir1, { recursive: true });
      await fs.mkdir(dir2, { recursive: true });
      await fs.mkdir(dir3, { recursive: true });

      await fs.writeFile(
        path.join(dir1, "skill.md"),
        `---
name: Skill A
description: Skill in sub1
---

# Content`
      );

      await fs.writeFile(
        path.join(dir2, "skill.md"),
        `---
name: Skill B
description: Skill in category2
---

# Content`
      );

      await fs.writeFile(
        path.join(dir3, "skill.md"),
        `---
name: Skill C
description: Root level skill
---

# Content`
      );

      const loader = new SkillLoader(skillsDir);
      const skills = await loader.loadAll();

      expect(skills).toHaveLength(3);
      const ids = skills.map(s => s.id).sort();
      expect(ids).toEqual(["skill-a", "skill-b", "skill-c"]);
    });
  });

  describe("case-insensitive skill.md support", () => {
    it("should load skill.md (lowercase)", async () => {
      const skillDir = path.join(skillsDir, "skill-lowercase");
      await fs.mkdir(skillDir);
      await fs.writeFile(
        path.join(skillDir, "skill.md"),
        `---
name: Lowercase Skill
description: skill.md (lowercase)
---

# Content`
      );

      const loader = new SkillLoader(skillsDir);
      const skills = await loader.loadAll();

      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe("skill-lowercase");
    });

    it("should load SKILL.md (uppercase)", async () => {
      const skillDir = path.join(skillsDir, "skill-uppercase");
      await fs.mkdir(skillDir);
      await fs.writeFile(
        path.join(skillDir, "SKILL.MD"),
        `---
name: Uppercase Skill
description: SKILL.MD (uppercase)
---

# Content`
      );

      const loader = new SkillLoader(skillsDir);
      const skills = await loader.loadAll();

      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe("skill-uppercase");
    });

    it("should load Skill.md (mixed case)", async () => {
      const skillDir = path.join(skillsDir, "skill-mixed");
      await fs.mkdir(skillDir);
      await fs.writeFile(
        path.join(skillDir, "Skill.Md"),
        `---
name: Mixed Case Skill
description: Skill.Md (mixed case)
---

# Content`
      );

      const loader = new SkillLoader(skillsDir);
      const skills = await loader.loadAll();

      expect(skills).toHaveLength(1);
      expect(skills[0].id).toBe("skill-mixed");
    });

    it("should load skills with different case variations in same directory", async () => {
      const dir1 = path.join(skillsDir, "case1");
      const dir2 = path.join(skillsDir, "case2");
      const dir3 = path.join(skillsDir, "case3");

      await fs.mkdir(dir1);
      await fs.mkdir(dir2);
      await fs.mkdir(dir3);

      await fs.writeFile(
        path.join(dir1, "skill.md"),
        `---
name: Skill 1
description: lowercase
---

# Content`
      );

      await fs.writeFile(
        path.join(dir2, "SKILL.MD"),
        `---
name: Skill 2
description: uppercase
---

# Content`
      );

      await fs.writeFile(
        path.join(dir3, "Skill.md"),
        `---
name: Skill 3
description: mixed case
---

# Content`
      );

      const loader = new SkillLoader(skillsDir);
      const skills = await loader.loadAll();

      expect(skills).toHaveLength(3);
      const descriptions = skills.map(s => s.description).sort();
      expect(descriptions).toEqual(["lowercase", "mixed case", "uppercase"]);
    });
  });
});
