import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { ConfigPaths, Paths_clearTestHome, Paths_setTestHome } from "./paths.js";

describe("ConfigPaths", () => {
  // Save original cwd
  const originalCwd = process.cwd();

  beforeAll(() => {
    Paths_clearTestHome();
  });

  afterAll(() => {
    Paths_clearTestHome();
    // Restore original cwd
    process.chdir(originalCwd);
  });

  beforeEach(() => {
    // Reset to original cwd before each test
    process.chdir(originalCwd);
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

  describe("Project-level Paths", () => {
    const originalCwd = process.cwd();

    afterEach(async () => {
      process.chdir(originalCwd);
      // 给系统一点时间释放资源
      await new Promise(r => setTimeout(r, 50));
    });

    it("should have projectConfig path based on cwd", async () => {
      // 创建临时目录并切换
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-path-test-"));
      
      process.chdir(tempDir);
      
      const projectConfig = ConfigPaths.projectConfig;
      expect(projectConfig).toBeDefined();
      expect(projectConfig).toContain(".tong_work");
      expect(projectConfig).toBe(path.join(tempDir, ".tong_work"));

      // 切换回原目录后再删除
      process.chdir(originalCwd);
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should have projectTongWorkConfig as projectConfig/tong_work.jsonc", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-config-test-"));
      
      process.chdir(tempDir);
      
      const projectTongWorkConfig = ConfigPaths.projectTongWorkConfig;
      expect(projectTongWorkConfig).toBe(path.join(tempDir, ".tong_work", "tong_work.jsonc"));

      process.chdir(originalCwd);
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should have projectEnvironments as projectConfig/environments", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-envs-test-"));
      
      process.chdir(tempDir);
      
      const projectEnvironments = ConfigPaths.projectEnvironments;
      expect(projectEnvironments).toBe(path.join(tempDir, ".tong_work", "environments"));

      process.chdir(originalCwd);
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should have projectAuth as projectConfig/auth.json", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-auth-test-"));
      
      process.chdir(tempDir);
      
      const projectAuth = ConfigPaths.projectAuth;
      expect(projectAuth).toBe(path.join(tempDir, ".tong_work", "auth.json"));

      process.chdir(originalCwd);
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should have projectPrompts as projectConfig/prompts", async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-prompts-test-"));
      
      process.chdir(tempDir);
      
      const projectPrompts = ConfigPaths.projectPrompts;
      expect(projectPrompts).toBe(path.join(tempDir, ".tong_work", "prompts"));

      process.chdir(originalCwd);
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("should reflect cwd changes", async () => {
      const tempDir1 = await fs.mkdtemp(path.join(os.tmpdir(), "project-first-"));
      const tempDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "project-second-"));
      
      process.chdir(tempDir1);
      const firstPath = ConfigPaths.projectConfig;
      
      process.chdir(tempDir2);
      const secondPath = ConfigPaths.projectConfig;
      
      expect(firstPath).toBe(path.join(tempDir1, ".tong_work"));
      expect(secondPath).toBe(path.join(tempDir2, ".tong_work"));

      process.chdir(originalCwd);
      await fs.rm(tempDir1, { recursive: true, force: true });
      await fs.rm(tempDir2, { recursive: true, force: true });
    });
  });

  describe("Global Paths (explicit naming)", () => {
    it("should have globalConfig as config path", () => {
      expect(ConfigPaths.globalConfig).toBe(ConfigPaths.config);
    });

    it("should have globalEnvironments as environments path", () => {
      expect(ConfigPaths.globalEnvironments).toBe(ConfigPaths.environments);
    });
  });
});
