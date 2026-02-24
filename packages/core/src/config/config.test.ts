import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  Config_get,
  Config_reload,
  Config_clear,
  Config_getSync,
  Config_onChange,
  Config_notifyChange,
  configRegistry,
  initDefaultSources,
  loadConfig,
  createFileSource,
} from "./index.js";
import type { Config } from "./types.js";

// 测试用的临时目录
let tempDir: string;

describe("Config", () => {
  beforeEach(async () => {
    // 创建临时目录
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-test-"));
    
    // 清理缓存和注册表
    Config_clear();
    configRegistry.clear();
  });

  afterEach(async () => {
    // 清理注册表
    configRegistry.clear();
    // 清理临时目录
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("Basic Loading", () => {
    it("should load config from default sources", async () => {
      initDefaultSources();
      const config = await loadConfig();
      
      // Default sources should load from global config
      expect(config).toBeDefined();
      // activeEnvironment may or may not be defined depending on global config
      expect(config.defaultModel).toBeDefined();
    });

    it("should load config from file source", async () => {
      const configFile = path.join(tempDir, "test-config.json");
      await fs.writeFile(
        configFile,
        JSON.stringify({
          defaultModel: "gpt-4",
          baseURL: "https://api.example.com",
        })
      );
      
      configRegistry.register(createFileSource(configFile, 0));
      const config = await loadConfig();
      
      expect(config.defaultModel).toBe("gpt-4");
      expect(config.baseURL).toBe("https://api.example.com");
    });

    it("should load config from inline source", async () => {
      const { createInlineSource } = await import("./sources/inline.js");
      
      configRegistry.register(createInlineSource(
        JSON.stringify({ defaultModel: "claude-3" }),
        0
      ));
      
      const config = await loadConfig();
      expect(config.defaultModel).toBe("claude-3");
    });
  });

  describe("Caching", () => {
    it("should not cache loadConfig results", async () => {
      const { createInlineSource } = await import("./sources/inline.js");
      
      configRegistry.register(createInlineSource(
        JSON.stringify({ defaultModel: "model-1" }),
        0
      ));
      
      const config1 = await loadConfig();
      const config2 = await loadConfig();
      
      // loadConfig 不缓存，每次都是新对象
      expect(config1).not.toBe(config2);
      expect(config1.defaultModel).toBe("model-1");
      expect(config2.defaultModel).toBe("model-1");
    });

    it("should clear cache when Config_clear is called", async () => {
      const { createInlineSource } = await import("./sources/inline.js");
      
      configRegistry.register(createInlineSource(
        JSON.stringify({ defaultModel: "test" }),
        0
      ));
      
      const config1 = await Config_get();
      Config_clear();
      const config2 = await Config_get();
      
      // 清除缓存后应该是新对象
      expect(config1).not.toBe(config2);
    });

    it("should return null for Config_getSync when not loaded", () => {
      Config_clear();
      const config = Config_getSync();
      expect(config).toBeNull();
    });

    it("should return cached config for Config_getSync after load", async () => {
      const { createInlineSource } = await import("./sources/inline.js");
      
      configRegistry.register(createInlineSource(
        JSON.stringify({ defaultModel: "cached" }),
        0
      ));
      
      await Config_get();
      
      const config = Config_getSync();
      expect(config).not.toBeNull();
      expect(config?.defaultModel).toBe("cached");
    });
  });

  describe("Change Notifications", () => {
    it("should notify listeners when config changes", async () => {
      initDefaultSources();
      
      const changes: Config.Info[] = [];
      const unsubscribe = Config_onChange((config) => {
        changes.push(config);
      });
      
      // 触发变更通知
      const testConfig: Config.Info = { defaultModel: "test-model" };
      Config_notifyChange(testConfig);
      
      expect(changes.length).toBe(1);
      expect(changes[0].defaultModel).toBe("test-model");
      
      // 取消订阅
      unsubscribe();
      
      // 再次触发，不应该收到通知
      Config_notifyChange({ defaultModel: "another-model" });
      expect(changes.length).toBe(1);
    });

    it("should support multiple listeners", async () => {
      initDefaultSources();
      
      const changes1: Config.Info[] = [];
      const changes2: Config.Info[] = [];
      
      const unsubscribe1 = Config_onChange((c) => changes1.push(c));
      const unsubscribe2 = Config_onChange((c) => changes2.push(c));
      
      Config_notifyChange({ defaultModel: "test" });
      
      expect(changes1.length).toBe(1);
      expect(changes2.length).toBe(1);
      
      unsubscribe1();
      unsubscribe2();
    });
  });

  describe("Config Merging", () => {
    it("should deep merge nested objects", async () => {
      const { createInlineSource } = await import("./sources/inline.js");
      
      // 第一个配置源
      configRegistry.register(createInlineSource(
        JSON.stringify({
          providers: {
            openai: {
              baseURL: "https://api.openai.com",
              defaultModel: "gpt-4",
            },
          },
        }),
        0
      ));
      
      // 第二个配置源（更高优先级）
      configRegistry.register(createInlineSource(
        JSON.stringify({
          providers: {
            anthropic: {
              baseURL: "https://api.anthropic.com",
              defaultModel: "claude-3",
            },
          },
        }),
        10
      ));
      
      const config = await loadConfig();
      
      // 两个 provider 都应该存在
      expect(config.providers?.openai).toBeDefined();
      expect(config.providers?.anthropic).toBeDefined();
      expect(config.providers?.openai?.baseURL).toBe("https://api.openai.com");
      expect(config.providers?.anthropic?.baseURL).toBe("https://api.anthropic.com");
    });

    it("should override nested properties", async () => {
      const { createInlineSource } = await import("./sources/inline.js");
      
      // 第一个配置源
      configRegistry.register(createInlineSource(
        JSON.stringify({
          providers: {
            openai: {
              name: "OpenAI",
              baseURL: "https://api.openai.com",
              defaultModel: "gpt-4",
            },
          },
        }),
        0
      ));
      
      // 第二个配置源覆盖嵌套属性
      configRegistry.register(createInlineSource(
        JSON.stringify({
          providers: {
            openai: {
              defaultModel: "gpt-5",
            },
          },
        }),
        10
      ));
      
      const config = await loadConfig();
      
      expect(config.providers?.openai?.defaultModel).toBe("gpt-5");
      // baseURL 应该保留
      expect(config.providers?.openai?.baseURL).toBe("https://api.openai.com");
    });
  });
});
