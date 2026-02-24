import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { Paths_setTestHome, Paths_clearTestHome } from "../paths.js";

const TEST_DIR = path.join(os.tmpdir(), `agent-core-test-${Date.now()}`);

describe("providers config", () => {
  beforeEach(async () => {
    Paths_setTestHome(TEST_DIR);
    await fs.mkdir(path.join(TEST_DIR, ".config", "tong_work", "agent-core"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    Paths_clearTestHome();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  test("loadProvidersConfig loads providers.jsonc", async () => {
    const providersContent = `{
      "defaultModel": "anthropic/claude-3-5-sonnet",
      "providers": {
        "anthropic": {
          "name": "Anthropic",
          "description": "Claude models",
          "baseURL": "https://api.anthropic.com/v1",
          "apiKey": "\${ANTHROPIC_API_KEY}",
          "models": ["claude-3-5-sonnet"],
          "defaultModel": "claude-3-5-sonnet"
        }
      }
    }`;

    await fs.writeFile(
      path.join(TEST_DIR, ".config", "tong_work", "agent-core", "providers.jsonc"),
      providersContent
    );

    const { loadProvidersConfig } = await import("../sources/providers.js");
    const config = await loadProvidersConfig();

    expect(config).not.toBeNull();
    expect(config?.defaultModel).toBe("anthropic/claude-3-5-sonnet");
    expect(config?.providers).toHaveProperty("anthropic");
    expect(config?.providers?.anthropic?.name).toBe("Anthropic");
    expect(config?.providers?.anthropic?.baseURL).toBe("https://api.anthropic.com/v1");
  });

  test("loadProvidersConfig returns null when file not exists", async () => {
    const { loadProvidersConfig } = await import("../sources/providers.js");
    const config = await loadProvidersConfig();
    expect(config).toBeNull();
  });

  test("loadProvidersConfig handles comments in jsonc", async () => {
    const providersContent = `// This is a comment
{
  // Provider with comment
  "providers": {
    "openai": {
      "name": "OpenAI" // inline comment
    }
  }
}`;

    await fs.writeFile(
      path.join(TEST_DIR, ".config", "tong_work", "agent-core", "providers.jsonc"),
      providersContent
    );

    const { loadProvidersConfig } = await import("../sources/providers.js");
    const config = await loadProvidersConfig();

    expect(config).not.toBeNull();
    expect(config?.providers?.openai?.name).toBe("OpenAI");
  });

  test("providersSource has correct priority", async () => {
    const { providersSource } = await import("../sources/providers.js");
    expect(providersSource.priority).toBe(1);
    expect(providersSource.name).toBe("providers");
  });
});

describe("providers merge logic", () => {
  beforeEach(async () => {
    Paths_setTestHome(TEST_DIR);
    await fs.mkdir(path.join(TEST_DIR, ".config", "tong_work", "agent-core"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    Paths_clearTestHome();
  });

  test("Providers_getAll merges built-in with providers.jsonc", async () => {
    const providersContent = `{
      "providers": {
        "zhipuai": {
          "name": "ZhipuAI",
          "baseURL": "https://custom.zhipuai.cn/api/paas/v4",
          "apiKey": "\${ZHIPUAI_API_KEY}",
          "models": ["glm-4-custom"],
          "defaultModel": "glm-4-custom"
        }
      }
    }`;

    await fs.writeFile(
      path.join(TEST_DIR, ".config", "tong_work", "agent-core", "providers.jsonc"),
      providersContent
    );

    const { Providers_getAll } = await import("../providers.js");
    const providers = await Providers_getAll();

    const zhipuai = providers.find((p) => p.id === "zhipuai");
    expect(zhipuai).toBeDefined();
    expect(zhipuai?.name).toBe("ZhipuAI");
    expect(zhipuai?.baseURL).toBe("https://custom.zhipuai.cn/api/paas/v4");
    expect(zhipuai?.models).toContain("glm-4-custom");

    const anthropic = providers.find((p) => p.id === "anthropic");
    expect(anthropic).toBeDefined();
    expect(anthropic?.baseURL).toBe("https://api.anthropic.com/v1");
  });

  test("Providers_getAll includes custom provider option", async () => {
    const { Providers_getAll } = await import("../providers.js");
    const providers = await Providers_getAll();

    const custom = providers.find((p) => p.id === "custom");
    expect(custom).toBeDefined();
    expect(custom?.name).toBe("Custom Provider");
  });
});
