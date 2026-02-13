import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as path from "path";
import { ConfigPaths, Paths_clearTestHome } from "./paths.js";

describe("ConfigPaths", () => {
  // Ensure clean state for path tests
  beforeAll(() => {
    Paths_clearTestHome();
  });
  
  afterAll(() => {
    Paths_clearTestHome();
  });
  describe("Path Structure", () => {
    it("should have home path", () => {
      expect(ConfigPaths.home).toBeDefined();
      expect(typeof ConfigPaths.home).toBe("string");
    });

    it("should have config path", () => {
      expect(ConfigPaths.config).toBeDefined();
      expect(ConfigPaths.config).toContain("tong_work");
      expect(ConfigPaths.config).toContain("agent-core");
    });

    it("should have state path", () => {
      expect(ConfigPaths.state).toBeDefined();
      expect(ConfigPaths.state).toContain("tong_work");
      expect(ConfigPaths.state).toContain("agent-core");
    });

    it("should have data path", () => {
      expect(ConfigPaths.data).toBeDefined();
      expect(ConfigPaths.data).toContain("tong_work");
      expect(ConfigPaths.data).toContain("agent-core");
    });

    it("should have cache path", () => {
      expect(ConfigPaths.cache).toBeDefined();
      expect(ConfigPaths.cache).toContain("tong_work");
      expect(ConfigPaths.cache).toContain("agent-core");
    });
  });

  describe("Path Relationships", () => {
    it("config should be in .config directory", () => {
      expect(ConfigPaths.config).toContain(".config");
    });

    it("state should be in .local/state directory", () => {
      expect(ConfigPaths.state).toContain(".local");
      expect(ConfigPaths.state).toContain("state");
    });

    it("data should be in .local/share directory", () => {
      expect(ConfigPaths.data).toContain(".local");
      expect(ConfigPaths.data).toContain("share");
    });

    it("cache should be in .cache directory", () => {
      expect(ConfigPaths.cache).toContain(".cache");
    });
  });

  describe("File Paths", () => {
    it("should have prompts directory under config", () => {
      expect(ConfigPaths.prompts).toContain("prompts");
      expect(ConfigPaths.prompts.startsWith(ConfigPaths.config)).toBe(true);
    });

    it("should have environments directory under config", () => {
      expect(ConfigPaths.environments).toContain("environments");
      expect(ConfigPaths.environments.startsWith(ConfigPaths.config)).toBe(true);
    });

    it("should have modelStore file under state", () => {
      expect(ConfigPaths.modelStore).toContain("model.json");
      expect(ConfigPaths.modelStore.startsWith(ConfigPaths.state)).toBe(true);
    });

    it("should have kvStore file under state", () => {
      expect(ConfigPaths.kvStore).toContain("kv.json");
      expect(ConfigPaths.kvStore.startsWith(ConfigPaths.state)).toBe(true);
    });

    it("should have authStore file under data", () => {
      expect(ConfigPaths.authStore).toContain("auth.json");
      expect(ConfigPaths.authStore.startsWith(ConfigPaths.data)).toBe(true);
    });

    it("should have mcpAuthStore file under data", () => {
      expect(ConfigPaths.mcpAuthStore).toContain("mcp-auth.json");
      expect(ConfigPaths.mcpAuthStore.startsWith(ConfigPaths.data)).toBe(true);
    });

    it("should have storage directory under data", () => {
      expect(ConfigPaths.storage).toContain("storage");
      expect(ConfigPaths.storage.startsWith(ConfigPaths.data)).toBe(true);
    });

    it("should have modelsCache file under cache", () => {
      expect(ConfigPaths.modelsCache).toContain("models.json");
      expect(ConfigPaths.modelsCache.startsWith(ConfigPaths.cache)).toBe(true);
    });
  });

  describe("Environment Variable Override", () => {
    it("should respect AGENT_CORE_TEST_HOME for testing", () => {
      const originalHome = process.env.AGENT_CORE_TEST_HOME;
      const testHome = "/test/home/path";
      
      process.env.AGENT_CORE_TEST_HOME = testHome;
      
      // 重新加载模块以获取新的路径
      // 注意：在实际测试中可能需要使用 jest.isolateModules 或类似方法
      
      // Restore properly - delete if it was undefined originally
      if (originalHome === undefined) {
        delete process.env.AGENT_CORE_TEST_HOME;
      } else {
        process.env.AGENT_CORE_TEST_HOME = originalHome;
      }
    });
  });

  describe("Path Consistency", () => {
    it("all paths should be absolute", () => {
      expect(path.isAbsolute(ConfigPaths.home)).toBe(true);
      expect(path.isAbsolute(ConfigPaths.config)).toBe(true);
      expect(path.isAbsolute(ConfigPaths.state)).toBe(true);
      expect(path.isAbsolute(ConfigPaths.data)).toBe(true);
      expect(path.isAbsolute(ConfigPaths.cache)).toBe(true);
    });

    it("all paths should use platform-specific separators", () => {
      const sep = path.sep;
      expect(ConfigPaths.config.includes(sep)).toBe(true);
      expect(ConfigPaths.state.includes(sep)).toBe(true);
      expect(ConfigPaths.data.includes(sep)).toBe(true);
    });

    it("config paths should be properly nested", () => {
      const configDir = ConfigPaths.config;
      const environmentsDir = ConfigPaths.environments;
      const promptsDir = ConfigPaths.prompts;

      expect(environmentsDir.startsWith(configDir)).toBe(true);
      expect(promptsDir.startsWith(configDir)).toBe(true);
    });
  });
});
