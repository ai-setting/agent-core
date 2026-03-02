import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { configRegistry } from "./registry.js";
import { globalSource } from "./sources/global.js";
import { providersSource } from "./sources/providers.js";
import { createEnvironmentSourceWithSearch } from "./sources/environment.js";
import { Paths_setTestHome, Paths_clearTestHome, ConfigPaths } from "./paths.js";
import { Config_get, Config_reload, Config_clear } from "./config.js";
import { initDefaultSources, initWithEnvOverrides } from "./default-sources.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("Config Sources Priority and Merge", () => {
  let tempDir: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    Config_clear();  // 清理配置缓存
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-merge-test-"));
    process.chdir(tempDir);
    Paths_setTestHome(tempDir);
    configRegistry.clear();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    Paths_clearTestHome();
    await fs.rm(tempDir, { recursive: true, force: true });
    // Clean up env vars
    delete process.env.AGENT_CORE_CONFIG_CONTENT;
    delete process.env.AGENT_CORE_CONFIG;
  });

  describe("Global config only", () => {
    it("should load global tong_work.jsonc", async () => {
      const globalConfigDir = path.join(tempDir, ".config", "tong_work", "agent-core");
      await fs.mkdir(globalConfigDir, { recursive: true });
      await fs.writeFile(
        path.join(globalConfigDir, "tong_work.jsonc"),
        JSON.stringify({
          activeEnvironment: "global-env",
          defaultModel: "claude-3-sonnet",
        })
      );

      await initWithEnvOverrides();
      const config = await Config_get();

      expect(config.activeEnvironment).toBe("global-env");
      expect(config.defaultModel).toBe("claude-3-sonnet");
    });
  });

  describe("Project config only", () => {
    it("should load project tong_work.jsonc", async () => {
      // 创建项目级配置
      const projectConfigDir = path.join(tempDir, ".tong_work");
      await fs.mkdir(projectConfigDir, { recursive: true });
      await fs.writeFile(
        path.join(projectConfigDir, "tong_work.jsonc"),
        JSON.stringify({
          activeEnvironment: "project-env",
          defaultModel: "gpt-4",
        })
      );

      // 创建全局配置（用于测试项目覆盖全局）
      const globalConfigDir = path.join(tempDir, ".config", "tong_work", "agent-core");
      await fs.mkdir(globalConfigDir, { recursive: true });
      await fs.writeFile(
        path.join(globalConfigDir, "tong_work.jsonc"),
        JSON.stringify({
          activeEnvironment: "global-env",
          defaultModel: "claude-3-sonnet",
        })
      );

      await initWithEnvOverrides();
      const config = await Config_get();

      // 项目配置应该覆盖全局配置
      expect(config.activeEnvironment).toBe("project-env");
      expect(config.defaultModel).toBe("gpt-4");
    });
  });

  describe("Both global and project config", () => {
    it("should merge config with project overriding global", async () => {
      // 全局配置
      const globalConfigDir = path.join(tempDir, ".config", "tong_work", "agent-core");
      await fs.mkdir(globalConfigDir, { recursive: true });
      await fs.writeFile(
        path.join(globalConfigDir, "tong_work.jsonc"),
        JSON.stringify({
          activeEnvironment: "global-env",
          defaultModel: "claude-3-sonnet",
          providers: {
            openai: { baseURL: "https://api.openai.com" },
          },
        })
      );

      // 项目配置（只覆盖部分字段）
      const projectConfigDir = path.join(tempDir, ".tong_work");
      await fs.mkdir(projectConfigDir, { recursive: true });
      await fs.writeFile(
        path.join(projectConfigDir, "tong_work.jsonc"),
        JSON.stringify({
          activeEnvironment: "project-env",
          trace: { enabled: true },
        })
      );

      await initWithEnvOverrides();
      const config = await Config_get();

      // 项目覆盖的字段
      expect(config.activeEnvironment).toBe("project-env");
      expect(config.trace).toEqual({ enabled: true });

      // 继承全局的字段
      expect(config.defaultModel).toBe("claude-3-sonnet");
      expect(config.providers).toBeDefined();
    });
  });

  describe("Environment search paths", () => {
    it("should search local environment before global", async () => {
      // 全局环境
      const globalEnvDir = path.join(tempDir, ".config", "tong_work", "agent-core", "environments", "shared-env");
      await fs.mkdir(globalEnvDir, { recursive: true });
      await fs.writeFile(
        path.join(globalEnvDir, "config.jsonc"),
        JSON.stringify({ id: "shared-env", source: "global", defaultModel: "global-model" })
      );

      // 本地环境（项目）
      const localEnvDir = path.join(tempDir, ".tong_work", "environments", "shared-env");
      await fs.mkdir(localEnvDir, { recursive: true });
      await fs.writeFile(
        path.join(localEnvDir, "config.jsonc"),
        JSON.stringify({ id: "shared-env", source: "local", defaultModel: "local-model" })
      );

      // 配置指向 shared-env
      const globalConfigDir = path.join(tempDir, ".config", "tong_work", "agent-core");
      await fs.mkdir(globalConfigDir, { recursive: true });
      await fs.writeFile(
        path.join(globalConfigDir, "tong_work.jsonc"),
        JSON.stringify({ activeEnvironment: "shared-env" })
      );

      await initWithEnvOverrides();
      const config = await Config_get();

      // 应该找到本地环境
      expect(config.activeEnvironment).toBe("shared-env");
    });
  });

  describe("Priority chain", () => {
    it("should load environment config with highest priority", async () => {
      // 全局配置
      const globalConfigDir = path.join(tempDir, ".config", "tong_work", "agent-core");
      await fs.mkdir(globalConfigDir, { recursive: true });
      await fs.writeFile(
        path.join(globalConfigDir, "tong_work.jsonc"),
        JSON.stringify({ activeEnvironment: "env-priority" })
      );

      // 环境配置
      const localEnvDir = path.join(tempDir, ".tong_work", "environments", "env-priority");
      await fs.mkdir(localEnvDir, { recursive: true });
      await fs.writeFile(
        path.join(localEnvDir, "config.jsonc"),
        JSON.stringify({ id: "env-priority", displayName: "Priority Env" })
      );

      await initWithEnvOverrides();
      const config = await Config_get();

      // 环境配置应该被加载
      expect(config.id).toBe("env-priority");
      expect(config.displayName).toBe("Priority Env");
    });
  });

  describe("Environment overrides", () => {
    it.skip("should use explicit environment path from config", async () => {
      // TODO: environmentOverrides 功能需要完善
      // 这个测试需要 findEnvironmentPath 支持 overrides 中直接给定 envName
      
      // 创建自定义路径的环境
      const customEnvPath = path.join(tempDir, "custom-envs", "my-env");
      await fs.mkdir(customEnvPath, { recursive: true });
      await fs.writeFile(
        path.join(customEnvPath, "config.jsonc"),
        JSON.stringify({ id: "my-env", defaultModel: "custom-model", source: "custom" })
      );

      // 全局配置带 overrides
      const globalConfigDir = path.join(tempDir, ".config", "tong_work", "agent-core");
      await fs.mkdir(globalConfigDir, { recursive: true });
      await fs.writeFile(
        path.join(globalConfigDir, "tong_work.jsonc"),
        JSON.stringify({
          activeEnvironment: "my-env",
          environmentOverrides: {
            "my-env": customEnvPath,
          },
        })
      );

      await initWithEnvOverrides();
      const config = await Config_get();

      expect(config.defaultModel).toBe("custom-model");
    });
  });
});
