import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { loadPromptsFromEnvironment, loadPromptFromEnvironment } from "./loader.js";

describe("prompts/loader", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "prompts-test-"));
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("loadPromptsFromEnvironment", () => {
    it("should load prompts from user config directory", async () => {
      const promptsDir = join(tempDir, "os_env", "prompts");
      await mkdir(promptsDir, { recursive: true });
      await writeFile(
        join(promptsDir, "system.prompt"),
        `---
id: system
description: Test system prompt
---
You are a test assistant.`
      );

      const prompts = await loadPromptsFromEnvironment("os_env", tempDir);

      expect(prompts).toHaveLength(1);
      expect(prompts[0].id).toBe("system");
      expect(prompts[0].content).toBe("You are a test assistant.");
      expect(prompts[0].metadata.description).toBe("Test system prompt");
    });

    it("should load multiple prompts", async () => {
      const promptsDir = join(tempDir, "os_env", "prompts");
      await mkdir(promptsDir, { recursive: true });
      await writeFile(join(promptsDir, "system.prompt"), "---\nid: system\n---\nSystem content");
      await writeFile(join(promptsDir, "coding.prompt"), "---\nid: coding\n---\nCoding content");

      const prompts = await loadPromptsFromEnvironment("os_env", tempDir);

      expect(prompts).toHaveLength(2);
      expect(prompts.map((p) => p.id).sort()).toEqual(["coding", "system"]);
    });

    it("should return empty array when prompts directory does not exist", async () => {
      const prompts = await loadPromptsFromEnvironment("nonexistent_env", tempDir);
      expect(prompts).toHaveLength(0);
    });

    it("should handle prompts without frontmatter", async () => {
      const promptsDir = join(tempDir, "os_env", "prompts");
      await mkdir(promptsDir, { recursive: true });
      await writeFile(join(promptsDir, "simple.prompt"), "Simple prompt without frontmatter");

      const prompts = await loadPromptsFromEnvironment("os_env", tempDir);

      expect(prompts).toHaveLength(1);
      expect(prompts[0].id).toBe("simple");
      expect(prompts[0].content).toBe("Simple prompt without frontmatter");
    });

    it("should fallback to built-in prompts when user prompts not found", async () => {
      const prompts = await loadPromptsFromEnvironment("os_env", tempDir);

      expect(prompts.length).toBeGreaterThan(0);
      expect(prompts[0].id).toBe("system");
    });
  });

  describe("loadPromptFromEnvironment", () => {
    it("should load a specific prompt by id from user config", async () => {
      const promptsDir = join(tempDir, "os_env", "prompts");
      await mkdir(promptsDir, { recursive: true });
      await writeFile(
        join(promptsDir, "system.prompt"),
        `---
id: system
description: Custom system
---
Custom content`
      );

      const prompt = await loadPromptFromEnvironment("os_env", "system", tempDir);

      expect(prompt).not.toBeNull();
      expect(prompt!.id).toBe("system");
      expect(prompt!.content).toBe("Custom content");
    });

    it("should return null when prompt does not exist", async () => {
      const promptsDir = join(tempDir, "os_env", "prompts");
      await mkdir(promptsDir, { recursive: true });
      await writeFile(join(promptsDir, "system.prompt"), "---\nid: system\n---\nContent");

      const prompt = await loadPromptFromEnvironment("os_env", "nonexistent", tempDir);

      expect(prompt).toBeNull();
    });

    it("should fallback to built-in prompt when not in user config", async () => {
      const promptsDir = join(tempDir, "os_env", "prompts");
      await mkdir(promptsDir, { recursive: true });
      await writeFile(join(promptsDir, "other.prompt"), "---\nid: other\n---\nOther content");

      const prompt = await loadPromptFromEnvironment("os_env", "system", tempDir);

      expect(prompt).not.toBeNull();
      expect(prompt!.id).toBe("system");
    });
  });
});
