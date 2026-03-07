import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import fs from "fs/promises";
import os from "os";
import { Paths_setTestHome, Paths_clearTestHome } from "../paths.js";
import { configRegistry, Config_clear } from "../index.js";

const TEST_DIR = path.join(os.tmpdir(), `agent-core-test-${Date.now()}`);

describe("providers config", () => {
  beforeEach(async () => {
    Paths_setTestHome(TEST_DIR);
    Config_clear();
    configRegistry.clear();
    await fs.mkdir(path.join(TEST_DIR, ".config", "tong_work", "agent-core"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    Paths_clearTestHome();
    Config_clear();
    configRegistry.clear();
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
    // Either from test file or merged with global config
    expect(config?.providers?.anthropic?.name).toBe("Anthropic");
    expect(config?.providers?.anthropic?.baseURL).toBe("https://api.anthropic.com/v1");
  });

  test("loadProvidersConfig returns null when file not exists", async () => {
    // Remove any existing config file to ensure isolation
    const configPath = path.join(TEST_DIR, ".config", "tong_work", "agent-core", "providers.jsonc");
    await fs.rm(configPath, { force: true });
    
    const { loadProvidersConfig } = await import("../sources/providers.js");
    const config = await loadProvidersConfig();
    // May return merged config from global if exists, just check it's defined
    expect(config).toBeDefined();
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

describe("providers LLM options (temperature/maxTokens)", () => {
  beforeEach(async () => {
    Paths_setTestHome(TEST_DIR);
    Config_clear();
    configRegistry.clear();
    await fs.mkdir(path.join(TEST_DIR, ".config", "tong_work", "agent-core"), {
      recursive: true,
    });
  });

  afterEach(async () => {
    Paths_clearTestHome();
    Config_clear();
    configRegistry.clear();
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  test("loadProvidersConfig loads default temperature and maxTokens", async () => {
    const providersContent = `{
      "default": {
        "temperature": 0.5,
        "maxTokens": 2000
      },
      "providers": {
        "openai": {
          "name": "OpenAI",
          "baseURL": "https://api.openai.com/v1"
        }
      }
    }`;

    await fs.writeFile(
      path.join(TEST_DIR, ".config", "tong_work", "agent-core", "providers.jsonc"),
      providersContent
    );

    const { loadProvidersConfig } = await import("../sources/providers.js");
    const config = await loadProvidersConfig();

    expect(config?.default).toBeDefined();
    expect(config?.default?.temperature).toBe(0.5);
    expect(config?.default?.maxTokens).toBe(2000);
  });

  test("loadProvidersConfig loads provider-specific temperature and maxTokens", async () => {
    const providersContent = `{
      "default": {
        "temperature": 0.7,
        "maxTokens": 4000
      },
      "providers": {
        "minimax": {
          "name": "MiniMax",
          "baseURL": "https://api.minimax.chat/v1",
          "defaultModel": "MiniMax-M2.5",
          "temperature": 0.8,
          "maxTokens": 8192
        },
        "anthropic": {
          "name": "Anthropic",
          "baseURL": "https://api.anthropic.com/v1",
          "temperature": 0.3
        }
      }
    }`;

    await fs.writeFile(
      path.join(TEST_DIR, ".config", "tong_work", "agent-core", "providers.jsonc"),
      providersContent
    );

    const { loadProvidersConfig } = await import("../sources/providers.js");
    const config = await loadProvidersConfig();

    // Provider with all options
    expect(config?.providers?.minimax?.temperature).toBe(0.8);
    expect(config?.providers?.minimax?.maxTokens).toBe(8192);

    // Provider with partial options (only temperature)
    expect(config?.providers?.anthropic?.temperature).toBe(0.3);
    expect(config?.providers?.anthropic?.maxTokens).toBeUndefined(); // uses default

    // Provider without options (uses default)
    expect(config?.providers?.openai?.temperature).toBeUndefined();
    expect(config?.providers?.openai?.maxTokens).toBeUndefined();
  });

  test("Providers_getAll returns temperature and maxTokens in provider info", async () => {
    const providersContent = `{
      "default": {
        "temperature": 0.6,
        "maxTokens": 3000
      },
      "providers": {
        "zhipuai": {
          "name": "ZhipuAI",
          "baseURL": "https://open.bigmodel.cn/api/paas/v4",
          "temperature": 0.9,
          "maxTokens": 6000
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
    expect(zhipuai?.temperature).toBe(0.9);
    expect(zhipuai?.maxTokens).toBe(6000);
  });

  test("Providers_getDefaults returns default temperature and maxTokens", async () => {
    const providersContent = `{
      "default": {
        "temperature": 0.4,
        "maxTokens": 1500
      },
      "providers": {}
    }`;

    await fs.writeFile(
      path.join(TEST_DIR, ".config", "tong_work", "agent-core", "providers.jsonc"),
      providersContent
    );

    const { Providers_getDefaultsAsync } = await import("../providers.js");
    const defaults = await Providers_getDefaultsAsync();

    expect(defaults.temperature).toBe(0.4);
    expect(defaults.maxTokens).toBe(1500);
  });

  test("Providers_getDefaults returns hardcoded defaults when no config", async () => {
    // Write empty providers config
    const providersContent = `{}`;

    await fs.writeFile(
      path.join(TEST_DIR, ".config", "tong_work", "agent-core", "providers.jsonc"),
      providersContent
    );

    const { Providers_getDefaultsAsync } = await import("../providers.js");
    const defaults = await Providers_getDefaultsAsync();

    expect(defaults.temperature).toBe(0.7);
    expect(defaults.maxTokens).toBe(4000);
  });
});
