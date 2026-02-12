import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  Auth_get,
  Auth_reload,
  Auth_getApiKey,
  Auth_getProvider,
  Auth_listProviders,
  Auth_save,
  Auth_setProvider,
  Auth_removeProvider,
  Auth_clearCache,
} from "./auth.js";
import { ConfigPaths, Paths_setTestHome, Paths_clearTestHome } from "./paths.js";
import type { Config } from "./types.js";

let tempDir: string;

describe("Auth", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "auth-test-"));
    
    // 使用新的 API 设置测试 home 目录
    Paths_setTestHome(tempDir);
    
    // 确保目录存在
    const dataDir = path.join(tempDir, ".local", "share", "tong_work", "agent-core");
    await fs.mkdir(dataDir, { recursive: true });
    
    // 清理缓存 - 使用 clearCache 确保完全隔离
    Auth_clearCache();
  });

  afterEach(async () => {
    // 清除测试 home 目录设置
    Paths_clearTestHome();
    
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("Basic Operations", () => {
    it("should return empty object when auth.json does not exist", async () => {
      const auth = await Auth_get();
      expect(auth).toEqual({});
    });

    it("should load auth.json from correct path", async () => {
      const authData: Config.Auth = {
        "test-provider": {
          type: "api",
          key: "test-key-123",
        },
      };

      const dataDir = path.join(tempDir, ".local", "share", "tong_work", "agent-core");
      await fs.writeFile(
        path.join(dataDir, "auth.json"),
        JSON.stringify(authData, null, 2)
      );

      const auth = await Auth_get();
      expect(auth["test-provider"]).toBeDefined();
      expect(auth["test-provider"].key).toBe("test-key-123");
    });

    it("should cache auth after first load", async () => {
      const authData: Config.Auth = {
        provider1: { type: "api", key: "key1" },
      };

      const dataDir = path.join(tempDir, ".local", "share", "tong_work", "agent-core");
      await fs.writeFile(
        path.join(dataDir, "auth.json"),
        JSON.stringify(authData)
      );

      const auth1 = await Auth_get();
      const auth2 = await Auth_get();

      // 应该是同一个对象（缓存）
      expect(auth1).toBe(auth2);
    });

    it("should reload auth with Auth_reload", async () => {
      const dataDir = path.join(tempDir, ".local", "share", "tong_work", "agent-core");
      
      // 初始数据
      await fs.writeFile(
        path.join(dataDir, "auth.json"),
        JSON.stringify({ provider1: { type: "api", key: "old-key" } })
      );

      await Auth_get();

      // 修改文件
      await fs.writeFile(
        path.join(dataDir, "auth.json"),
        JSON.stringify({ provider1: { type: "api", key: "new-key" } })
      );

      // 重新加载
      const auth = await Auth_reload();
      expect(auth.provider1.key).toBe("new-key");
    });
  });

  describe("Auth_getApiKey", () => {
    it("should return API key for api type provider", async () => {
      const authData: Config.Auth = {
        "my-provider": {
          type: "api",
          key: "secret-api-key",
        },
      };

      await Auth_save(authData);

      const apiKey = await Auth_getApiKey("my-provider");
      expect(apiKey).toBe("secret-api-key");
    });

    it("should return undefined for non-existent provider", async () => {
      const apiKey = await Auth_getApiKey("non-existent");
      expect(apiKey).toBeUndefined();
    });

    it("should return undefined for non-api type", async () => {
      const authData: Config.Auth = {
        "oauth-provider": {
          type: "oauth",
          key: "oauth-token",
        } as Config.Auth[string],
      };

      await Auth_save(authData);

      const apiKey = await Auth_getApiKey("oauth-provider");
      expect(apiKey).toBeUndefined();
    });

    it("should handle multiple providers", async () => {
      const authData: Config.Auth = {
        "provider1": { type: "api", key: "key1" },
        "provider2": { type: "api", key: "key2" },
        "provider3": { type: "api", key: "key3" },
      };

      await Auth_save(authData);

      expect(await Auth_getApiKey("provider1")).toBe("key1");
      expect(await Auth_getApiKey("provider2")).toBe("key2");
      expect(await Auth_getApiKey("provider3")).toBe("key3");
    });
  });

  describe("Auth_getProvider", () => {
    it("should return full provider config", async () => {
      const authData: Config.Auth = {
        "full-provider": {
          type: "api",
          key: "full-key",
          baseURL: "https://custom.api.com",
          metadata: {
            region: "us-west",
            version: "v2",
          },
        },
      };

      await Auth_save(authData);

      const provider = await Auth_getProvider("full-provider");
      expect(provider).toBeDefined();
      expect(provider?.type).toBe("api");
      expect(provider?.key).toBe("full-key");
      expect(provider?.baseURL).toBe("https://custom.api.com");
      expect(provider?.metadata?.region).toBe("us-west");
    });

    it("should return undefined for non-existent provider", async () => {
      const provider = await Auth_getProvider("non-existent");
      expect(provider).toBeUndefined();
    });
  });

  describe("Auth_listProviders", () => {
    it("should return empty array when no providers", async () => {
      const providers = await Auth_listProviders();
      expect(providers).toEqual([]);
    });

    it("should return all provider names", async () => {
      const authData: Config.Auth = {
        "anthropic": { type: "api", key: "key1" },
        "openai": { type: "api", key: "key2" },
        "zhipuai": { type: "api", key: "key3" },
      };

      await Auth_save(authData);

      const providers = await Auth_listProviders();
      expect(providers).toContain("anthropic");
      expect(providers).toContain("openai");
      expect(providers).toContain("zhipuai");
      expect(providers.length).toBe(3);
    });
  });

  describe("Auth_save", () => {
    it("should save auth data to file", async () => {
      const authData: Config.Auth = {
        "new-provider": {
          type: "api",
          key: "new-key",
        },
      };

      await Auth_save(authData);

      // 验证文件被创建
      const dataDir = path.join(tempDir, ".local", "share", "tong_work", "agent-core");
      const content = await fs.readFile(path.join(dataDir, "auth.json"), "utf-8");
      const saved = JSON.parse(content);
      
      expect(saved["new-provider"].key).toBe("new-key");
    });

    it("should create parent directories if not exist", async () => {
      // 删除已创建的目录
      const dataDir = path.join(tempDir, ".local", "share", "tong_work", "agent-core");
      await fs.rm(dataDir, { recursive: true, force: true });

      const authData: Config.Auth = {
        "test": { type: "api", key: "key" },
      };

      await Auth_save(authData);

      // 目录应该被创建
      const stats = await fs.stat(dataDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it("should update cache after save", async () => {
      const authData: Config.Auth = {
        "cached": { type: "api", key: "cached-key" },
      };

      await Auth_save(authData);

      // 直接从缓存读取应该返回新值
      const auth = await Auth_get();
      expect(auth.cached.key).toBe("cached-key");
    });
  });

  describe("Auth_setProvider", () => {
    it("should add new provider", async () => {
      await Auth_setProvider("new-provider", {
        type: "api",
        key: "new-provider-key",
        baseURL: "https://api.example.com",
      });

      const auth = await Auth_get();
      expect(auth["new-provider"]).toBeDefined();
      expect(auth["new-provider"].key).toBe("new-provider-key");
    });

    it("should update existing provider", async () => {
      await Auth_save({
        "existing": { type: "api", key: "old-key" },
      });

      await Auth_setProvider("existing", {
        type: "api",
        key: "new-key",
      });

      const auth = await Auth_get();
      expect(auth.existing.key).toBe("new-key");
    });

    it("should preserve other providers", async () => {
      await Auth_save({
        "keep1": { type: "api", key: "key1" },
        "update": { type: "api", key: "old-key" },
        "keep2": { type: "api", key: "key2" },
      });

      await Auth_setProvider("update", { type: "api", key: "new-key" });

      const auth = await Auth_get();
      expect(auth.keep1.key).toBe("key1");
      expect(auth.keep2.key).toBe("key2");
      expect(auth.update.key).toBe("new-key");
    });
  });

  describe("Auth_removeProvider", () => {
    it("should remove provider", async () => {
      await Auth_save({
        "remove-me": { type: "api", key: "key" },
        "keep-me": { type: "api", key: "key2" },
      });

      await Auth_removeProvider("remove-me");

      const auth = await Auth_get();
      expect(auth["remove-me"]).toBeUndefined();
      expect(auth["keep-me"]).toBeDefined();
    });

    it("should handle removing non-existent provider gracefully", async () => {
      await Auth_save({
        "existing": { type: "api", key: "key" },
      });

      // 不应该抛出错误
      await Auth_removeProvider("non-existent");

      const auth = await Auth_get();
      expect(auth.existing).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty auth.json file", async () => {
      const dataDir = path.join(tempDir, ".local", "share", "tong_work", "agent-core");
      await fs.writeFile(path.join(dataDir, "auth.json"), "");

      const auth = await Auth_get();
      expect(auth).toEqual({});
    });

    it("should handle malformed JSON gracefully", async () => {
      const dataDir = path.join(tempDir, ".local", "share", "tong_work", "agent-core");
      await fs.writeFile(path.join(dataDir, "auth.json"), "not-valid-json");

      // 应该返回空对象而不是抛出错误
      const auth = await Auth_get();
      expect(auth).toEqual({});
    });

    it("should handle special characters in keys", async () => {
      const authData: Config.Auth = {
        "provider-with-dashes": {
          type: "api",
          key: "key-with-!@#$%^&*()",
        },
      };

      await Auth_save(authData);

      const auth = await Auth_get();
      expect(auth["provider-with-dashes"].key).toBe("key-with-!@#$%^&*()");
    });

    it("should handle very long API keys", async () => {
      const longKey = "sk-" + "a".repeat(2000);
      const authData: Config.Auth = {
        "long-key-provider": {
          type: "api",
          key: longKey,
        },
      };

      await Auth_save(authData);

      const retrieved = await Auth_getApiKey("long-key-provider");
      expect(retrieved).toBe(longKey);
    });
  });
});
