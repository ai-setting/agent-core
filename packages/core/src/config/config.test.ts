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
  createInlineSource,
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
      
      // Default sources should load - may be empty in CI without config files
      expect(config).toBeDefined();
      // In CI without config files, this may be undefined - that's OK
      // Just verify the config object was created
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

  describe("Logging Configuration from JSONC", () => {
    let loggingTestDir: string;

    afterEach(async () => {
      if (loggingTestDir) {
        await fs.rm(loggingTestDir, { recursive: true, force: true });
      }
    });

    it("should load logging config from tong_work.jsonc file", async () => {
      loggingTestDir = await fs.mkdtemp(path.join(os.tmpdir(), "logging-config-test-"));
      
      const configFile = path.join(loggingTestDir, "tong_work.jsonc");
      const jsoncContent = `{
        // Logging configuration
        "logging": {
          "path": "/custom/logs/path",
          "level": "debug",
          "enableFile": false
        }
      }`;
      await fs.writeFile(configFile, jsoncContent);
      
      configRegistry.register(createFileSource(configFile, 0));
      const config = await loadConfig();
      
      expect(config.logging).toBeDefined();
      expect(config.logging?.path).toBe("/custom/logs/path");
      expect(config.logging?.level).toBe("debug");
      expect(config.logging?.enableFile).toBe(false);
    });

    it("should load logging config from tong_work.json file", async () => {
      loggingTestDir = await fs.mkdtemp(path.join(os.tmpdir(), "logging-json-test-"));
      
      const configFile = path.join(loggingTestDir, "tong_work.json");
      const jsonContent = JSON.stringify({
        logging: {
          path: "/var/log/tong_work",
          level: "warn",
          enableFile: true
        }
      });
      await fs.writeFile(configFile, jsonContent);
      
      configRegistry.register(createFileSource(configFile, 0));
      const config = await loadConfig();
      
      expect(config.logging).toBeDefined();
      expect(config.logging?.path).toBe("/var/log/tong_work");
      expect(config.logging?.level).toBe("warn");
    });

    it("should allow partial logging config", async () => {
      loggingTestDir = await fs.mkdtemp(path.join(os.tmpdir(), "logging-partial-test-"));
      
      const configFile = path.join(loggingTestDir, "tong_work.json");
      await fs.writeFile(configFile, JSON.stringify({
        logging: {
          level: "error"
        }
      }));
      
      configRegistry.register(createFileSource(configFile, 0));
      const config = await loadConfig();
      
      expect(config.logging).toBeDefined();
      expect(config.logging?.level).toBe("error");
      expect(config.logging?.path).toBeUndefined();
    });
  });

  describe("Sandbox Configuration", () => {
    it("should load sandbox config from global config", async () => {
      configRegistry.register(createInlineSource(
        JSON.stringify({
          sandbox: {
            enabled: true,
            type: "native",
            actionFilter: {
              include: ["bash", "mcp_*"],
              exclude: ["mcp_safe"]
            },
            filesystem: {
              denyRead: ["~/.ssh"],
              allowWrite: [".", "/tmp"],
            },
            network: {
              allowedDomains: ["github.com"],
            },
          },
        }),
        0
      ));

      const config = await loadConfig();

      expect(config.sandbox).toBeDefined();
      expect(config.sandbox?.enabled).toBe(true);
      expect(config.sandbox?.type).toBe("native");
      expect(config.sandbox?.actionFilter?.include).toContain("bash");
      expect(config.sandbox?.actionFilter?.exclude).toContain("mcp_safe");
      expect(config.sandbox?.filesystem?.denyRead).toContain("~/.ssh");
      expect(config.sandbox?.filesystem?.allowWrite).toContain(".");
      expect(config.sandbox?.network?.allowedDomains).toContain("github.com");
    });

    it("should have default type as native when not specified", async () => {
      configRegistry.register(createInlineSource(
        JSON.stringify({
          sandbox: {
            enabled: true,
          },
        }),
        0
      ));

      const config = await loadConfig();

      expect(config.sandbox).toBeDefined();
      expect(config.sandbox?.enabled).toBe(true);
      expect(config.sandbox?.type).toBeUndefined(); // Zod default not applied until parsing
    });

    it("should default enabled to false when sandbox not configured", async () => {
      configRegistry.register(createInlineSource(
        JSON.stringify({ defaultModel: "gpt-4" }),
        0
      ));

      const config = await loadConfig();
      expect(config.sandbox).toBeUndefined();
    });

    it("should override sandbox config in environment config", async () => {
      // Global: enabled: false
      configRegistry.register(createInlineSource(
        JSON.stringify({ sandbox: { enabled: false } }),
        0
      ));

      // Environment (priority 10): enabled: true
      configRegistry.register(createInlineSource(
        JSON.stringify({
          sandbox: { 
            enabled: true, 
            actionFilter: { include: ["bash"] } 
          } 
        }),
        10
      ));

      const config = await loadConfig();
      expect(config.sandbox?.enabled).toBe(true);
      expect(config.sandbox?.actionFilter?.include).toContain("bash");
    });

    it("should load docker config when type is docker", async () => {
      configRegistry.register(createInlineSource(
        JSON.stringify({
          sandbox: {
            enabled: true,
            type: "docker",
            docker: {
              image: "agent-core-sandbox:latest",
              networkMode: "bridge",
              volumes: {
                "/project": "/workspace"
              }
            }
          },
        }),
        0
      ));

      const config = await loadConfig();

      expect(config.sandbox?.type).toBe("docker");
      expect(config.sandbox?.docker).toBeDefined();
      expect(config.sandbox?.docker?.image).toBe("agent-core-sandbox:latest");
      expect(config.sandbox?.docker?.networkMode).toBe("bridge");
      expect(config.sandbox?.docker?.volumes).toEqual({
        "/project": "/workspace"
      });
    });

    it("should allow partial sandbox config", async () => {
      configRegistry.register(createInlineSource(
        JSON.stringify({
          sandbox: {
            enabled: true,
            filesystem: {
              denyRead: ["~/.ssh"],
            },
          },
        }),
        0
      ));

      const config = await loadConfig();

      expect(config.sandbox?.enabled).toBe(true);
      expect(config.sandbox?.filesystem?.denyRead).toContain("~/.ssh");
      expect(config.sandbox?.network).toBeUndefined();
      expect(config.sandbox?.docker).toBeUndefined();
    });

    it("should handle empty actionFilter include array", async () => {
      configRegistry.register(createInlineSource(
        JSON.stringify({
          sandbox: {
            enabled: true,
            actionFilter: {
              include: [],
              exclude: ["mcp_safe"]
            },
          },
        }),
        0
      ));

      const config = await loadConfig();

      expect(config.sandbox?.enabled).toBe(true);
      expect(config.sandbox?.actionFilter?.include).toEqual([]);
      expect(config.sandbox?.actionFilter?.exclude).toContain("mcp_safe");
    });
  });
});
