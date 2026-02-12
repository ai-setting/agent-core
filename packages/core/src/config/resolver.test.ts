import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { resolveValue, resolveObject, resolveConfig } from "./resolver.js";
import { Auth_save } from "./auth.js";
import { ConfigPaths } from "./paths.js";
import type { Config } from "./types.js";

let tempDir: string;
let originalHome: string | undefined;

describe("Resolver", () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "resolver-test-"));
    originalHome = process.env.AGENT_CORE_TEST_HOME;
    process.env.AGENT_CORE_TEST_HOME = tempDir;
  });

  afterEach(async () => {
    if (originalHome !== undefined) {
      process.env.AGENT_CORE_TEST_HOME = originalHome;
    } else {
      delete process.env.AGENT_CORE_TEST_HOME;
    }
    
    await fs.rm(tempDir, { recursive: true, force: true });
    
    // 清理环境变量
    delete process.env.TEST_API_KEY;
    delete process.env.CUSTOM_URL;
  });

  describe("resolveValue", () => {
    it("should return value as-is when no variable reference", async () => {
      const result = await resolveValue("simple-string");
      expect(result).toBe("simple-string");
    });

    it("should resolve auth reference ${auth:provider-name}", async () => {
      // 设置 auth.json
      await Auth_save({
        "test-provider": {
          type: "api",
          key: "test-api-key-12345",
        },
      });

      const result = await resolveValue("${auth:test-provider}");
      expect(result).toBe("test-api-key-12345");
    });

    it("should resolve environment variable ${ENV_VAR}", async () => {
      process.env.TEST_API_KEY = "env-api-key-67890";
      
      const result = await resolveValue("${TEST_API_KEY}");
      expect(result).toBe("env-api-key-67890");
    });

    it("should resolve multiple references in one string", async () => {
      await Auth_save({
        "provider1": {
          type: "api",
          key: "key1",
        },
      });
      process.env.KEY2 = "key2";

      const result = await resolveValue("prefix-${auth:provider1}-middle-${KEY2}-suffix");
      expect(result).toBe("prefix-key1-middle-key2-suffix");
    });

    it("should leave unresolved auth reference as-is", async () => {
      // auth.json 中没有这个 provider
      const result = await resolveValue("${auth:non-existent}");
      // 应该保持原样，因为无法解析
      expect(result).toBe("${auth:non-existent}");
    });

    it("should leave unresolved env variable as-is", async () => {
      const result = await resolveValue("${NON_EXISTENT_ENV}");
      expect(result).toBe("${NON_EXISTENT_ENV}");
    });

    it("should handle auth with baseURL", async () => {
      await Auth_save({
        "custom-provider": {
          type: "api",
          key: "api-key",
          baseURL: "https://custom.api.com",
        },
      });

      const result = await resolveValue("${auth:custom-provider}");
      expect(result).toBe("api-key");
    });

    it("should handle whitespace in reference", async () => {
      process.env.WHITESPACE_TEST = "value";
      
      const result = await resolveValue("${  WHITESPACE_TEST  }");
      expect(result).toBe("value");
    });
  });

  describe("resolveObject", () => {
    it("should resolve values in a flat object", async () => {
      await Auth_save({
        "key-provider": {
          type: "api",
          key: "resolved-key",
        },
      });

      const input = {
        apiKey: "${auth:key-provider}",
        name: "unchanged",
      };

      const result = await resolveObject(input);
      expect(result.apiKey).toBe("resolved-key");
      expect(result.name).toBe("unchanged");
    });

    it("should resolve nested objects", async () => {
      await Auth_save({
        "nested-auth": {
          type: "api",
          key: "nested-key",
        },
      });
      process.env.NESTED_ENV = "nested-env-value";

      const input = {
        provider: {
          apiKey: "${auth:nested-auth}",
          baseURL: "${NESTED_ENV}",
        },
        other: "value",
      };

      const result = await resolveObject(input);
      expect(result.provider.apiKey).toBe("nested-key");
      expect(result.provider.baseURL).toBe("nested-env-value");
    });

    it("should handle arrays with string values", async () => {
      process.env.ITEM1 = "first";
      process.env.ITEM2 = "second";

      const input = {
        items: ["${ITEM1}", "plain", "${ITEM2}"],
      };

      const result = await resolveObject(input);
      expect(result.items).toEqual(["first", "plain", "second"]);
    });

    it("should handle arrays with object values", async () => {
      await Auth_save({
        "arr-auth": {
          type: "api",
          key: "arr-key",
        },
      });

      const input = {
        providers: [
          { apiKey: "${auth:arr-auth}" },
          { apiKey: "plain-key" },
        ],
      };

      const result = await resolveObject(input);
      expect(result.providers[0].apiKey).toBe("arr-key");
      expect(result.providers[1].apiKey).toBe("plain-key");
    });

    it("should preserve non-string values", async () => {
      const input = {
        count: 42,
        enabled: true,
        nullValue: null,
      };

      const result = await resolveObject(input);
      expect(result.count).toBe(42);
      expect(result.enabled).toBe(true);
      expect(result.nullValue).toBeNull();
    });
  });

  describe("resolveConfig", () => {
    it("should resolve apiKey and baseURL in Config.Info", async () => {
      await Auth_save({
        "config-test": {
          type: "api",
          key: "resolved-api-key",
        },
      });
      process.env.CONFIG_URL = "https://resolved.url";

      const input: Config.Info = {
        defaultModel: "gpt-4",
        apiKey: "${auth:config-test}",
        baseURL: "${CONFIG_URL}",
      };

      const result = await resolveConfig(input);
      expect(result.apiKey).toBe("resolved-api-key");
      expect(result.baseURL).toBe("https://resolved.url");
      expect(result.defaultModel).toBe("gpt-4"); // 未改变
    });

    it("should resolve provider configurations", async () => {
      await Auth_save({
        "openai-auth": {
          type: "api",
          key: "openai-key",
        },
        "anthropic-auth": {
          type: "api",
          key: "anthropic-key",
        },
      });

      const input: Config.Info = {
        provider: {
          openai: {
            baseURL: "https://api.openai.com",
            apiKey: "${auth:openai-auth}",
          },
          anthropic: {
            baseURL: "https://api.anthropic.com",
            apiKey: "${auth:anthropic-auth}",
          },
        },
      };

      const result = await resolveConfig(input);
      expect(result.provider?.openai?.apiKey).toBe("openai-key");
      expect(result.provider?.anthropic?.apiKey).toBe("anthropic-key");
      expect(result.provider?.openai?.baseURL).toBe("https://api.openai.com"); // 未改变
    });

    it("should handle missing apiKey gracefully", async () => {
      const input: Config.Info = {
        defaultModel: "gpt-4",
        // apiKey 未设置
      };

      const result = await resolveConfig(input);
      expect(result.apiKey).toBeUndefined();
      expect(result.defaultModel).toBe("gpt-4");
    });

    it("should handle config without providers", async () => {
      const input: Config.Info = {
        activeEnvironment: "test",
        defaultModel: "gpt-4",
      };

      const result = await resolveConfig(input);
      expect(result.activeEnvironment).toBe("test");
      expect(result.provider).toBeUndefined();
    });

    it("should handle complex real-world config", async () => {
      // 模拟真实场景
      await Auth_save({
        "zhipuai-coding": {
          type: "api",
          key: "zhipuai-real-key",
        },
        "kimi-prod": {
          type: "api",
          key: "kimi-real-key",
          baseURL: "https://api.moonshot.cn/v1",
        },
      });

      const input: Config.Info = {
        activeEnvironment: "os_env",
        defaultModel: "anthropic/claude-sonnet-4-5",
        apiKey: "${auth:kimi-prod}",
        baseURL: "https://api.moonshot.cn/v1",
        provider: {
          zhipuai: {
            baseURL: "https://open.bigmodel.cn/api/paas/v4",
            apiKey: "${auth:zhipuai-coding}",
            defaultModel: "glm-4",
          },
          moonshot: {
            baseURL: "${auth:kimi-prod}",
            apiKey: "${auth:kimi-prod}",
            defaultModel: "moonshot-v1-128k",
          },
        },
      };

      const result = await resolveConfig(input);
      
      // 验证所有引用都被解析
      expect(result.apiKey).toBe("kimi-real-key");
      expect(result.provider?.zhipuai?.apiKey).toBe("zhipuai-real-key");
      expect(result.provider?.moonshot?.apiKey).toBe("kimi-real-key");
      expect(result.provider?.moonshot?.baseURL).toBe("kimi-real-key"); // 注意：这里会从 auth 读取 key，而不是 baseURL
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty string", async () => {
      const result = await resolveValue("");
      expect(result).toBe("");
    });

    it("should handle string with only whitespace", async () => {
      const result = await resolveValue("   ");
      expect(result).toBe("   ");
    });

    it("should handle malformed variable reference", async () => {
      const result = await resolveValue("${incomplete");
      expect(result).toBe("${incomplete");
    });

    it("should handle nested variable references (not supported)", async () => {
      // 嵌套引用不会被解析，保持原样
      process.env.OUTER = "${INNER}";
      process.env.INNER = "inner-value";
      
      const result = await resolveValue("${OUTER}");
      expect(result).toBe("${INNER}"); // 只解析一层
    });

    it("should handle special characters in resolved values", async () => {
      await Auth_save({
        "special": {
          type: "api",
          key: "key-with-!@#$%^&*()_+",
        },
      });

      const result = await resolveValue("${auth:special}");
      expect(result).toBe("key-with-!@#$%^&*()_+");
    });

    it("should handle very long API keys", async () => {
      const longKey = "sk-" + "a".repeat(1000);
      await Auth_save({
        "long-key": {
          type: "api",
          key: longKey,
        },
      });

      const result = await resolveValue("${auth:long-key}");
      expect(result).toBe(longKey);
    });
  });
});
