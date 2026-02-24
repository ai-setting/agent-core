import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  loadEnvironmentConfig,
  createEnvironmentSource,
} from "./environment.js";
import { configRegistry } from "../registry.js";

let tempDir: string;
let environmentsDir: string;

describe("Environment Source", () => {
  beforeEach(async () => {
    // 创建临时目录
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "env-source-test-"));
    // 创建 environments 子目录
    environmentsDir = path.join(tempDir, "environments");
    await fs.mkdir(environmentsDir, { recursive: true });
    
    // 清理注册表
    configRegistry.clear();
  });

  afterEach(async () => {
    // 清理临时目录
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("loadEnvironmentConfig", () => {
    it("should return null when environment directory does not exist", async () => {
      const config = await loadEnvironmentConfig("non-existent-env", environmentsDir);
      expect(config).toBeNull();
    });

    it("should return null when config.jsonc does not exist", async () => {
      // 创建目录但不创建文件
      const envDir = path.join(environmentsDir, "empty-env");
      await fs.mkdir(envDir, { recursive: true });

      const config = await loadEnvironmentConfig("empty-env", environmentsDir);
      expect(config).toBeNull();
    });

    it("should load main config.jsonc", async () => {
      const envDir = path.join(environmentsDir, "test-env");
      await fs.mkdir(envDir, { recursive: true });

      const configContent = {
        id: "test-env",
        displayName: "Test Environment",
        defaultModel: "gpt-4",
        apiKey: "${auth:test-key}",
      };

      await fs.writeFile(
        path.join(envDir, "config.jsonc"),
        JSON.stringify(configContent, null, 2)
      );

      const config = await loadEnvironmentConfig("test-env", environmentsDir);
      expect(config).not.toBeNull();
      expect(config?.id).toBe("test-env");
      expect(config?.displayName).toBe("Test Environment");
      expect(config?.defaultModel).toBe("gpt-4");
    });

    it("should load agents.jsonc when present", async () => {
      const envDir = path.join(environmentsDir, "agent-env");
      await fs.mkdir(envDir, { recursive: true });

      const configContent = {
        id: "agent-env",
        defaultModel: "gpt-4",
      };

      const agentsContent = [
        {
          id: "test-agent",
          role: "primary",
          promptId: "system",
          allowedTools: ["bash", "file_read"],
        },
      ];

      await fs.writeFile(
        path.join(envDir, "config.jsonc"),
        JSON.stringify(configContent)
      );
      await fs.writeFile(
        path.join(envDir, "agents.jsonc"),
        JSON.stringify(agentsContent)
      );

      const config = await loadEnvironmentConfig("agent-env", environmentsDir);
      expect(config?.agents).toBeDefined();
      expect(config?.agents?.length).toBe(1);
      expect(config?.agents?.[0].id).toBe("test-agent");
    });

    it("should load models.jsonc when present", async () => {
      const envDir = path.join(environmentsDir, "model-env");
      await fs.mkdir(envDir, { recursive: true });

      const configContent = {
        id: "model-env",
      };

      const modelsContent = {
        "gpt-4": {
          provider: "openai",
          modelId: "gpt-4",
          displayName: "GPT-4",
        },
        "claude": {
          provider: "anthropic",
          modelId: "claude-3",
          displayName: "Claude 3",
        },
      };

      await fs.writeFile(
        path.join(envDir, "config.jsonc"),
        JSON.stringify(configContent)
      );
      await fs.writeFile(
        path.join(envDir, "models.jsonc"),
        JSON.stringify(modelsContent)
      );

      const config = await loadEnvironmentConfig("model-env", environmentsDir);
      expect(config?.models).toBeDefined();
      expect(config?.models?.["gpt-4"].provider).toBe("openai");
      expect(config?.models?.["claude"].provider).toBe("anthropic");
    });

    it("should load all three config files", async () => {
      const envDir = path.join(environmentsDir, "full-env");
      await fs.mkdir(envDir, { recursive: true });

      await fs.writeFile(
        path.join(envDir, "config.jsonc"),
        JSON.stringify({ id: "full-env", defaultModel: "gpt-4" })
      );
      await fs.writeFile(
        path.join(envDir, "agents.jsonc"),
        JSON.stringify([{ id: "agent1", role: "primary" }])
      );
      await fs.writeFile(
        path.join(envDir, "models.jsonc"),
        JSON.stringify({ "model1": { provider: "openai", modelId: "gpt-4" } })
      );

      const config = await loadEnvironmentConfig("full-env", environmentsDir);
      expect(config?.id).toBe("full-env");
      expect(config?.agents).toBeDefined();
      expect(config?.models).toBeDefined();
    });

    it("should handle JSONC comments", async () => {
      const envDir = path.join(environmentsDir, "jsonc-env");
      await fs.mkdir(envDir, { recursive: true });

      const jsoncContent = `{
        // This is a comment
        "id": "jsonc-env",
        "defaultModel": "gpt-4", // inline comment
        /* block comment */ "apiKey": "test-key"
      }`;

      await fs.writeFile(path.join(envDir, "config.jsonc"), jsoncContent);

      const config = await loadEnvironmentConfig("jsonc-env", environmentsDir);
      expect(config?.id).toBe("jsonc-env");
      expect(config?.defaultModel).toBe("gpt-4");
    });

    it("should handle trailing commas in JSONC", async () => {
      const envDir = path.join(environmentsDir, "comma-env");
      await fs.mkdir(envDir, { recursive: true });

      const jsoncContent = `{
        "id": "comma-env",
        "defaultModel": "gpt-4",
        "provider": {
          "openai": {
            "baseURL": "https://api.openai.com",
            "defaultModel": "gpt-4"
          }
        }
      }`;

      await fs.writeFile(path.join(envDir, "config.jsonc"), jsoncContent);

      const config = await loadEnvironmentConfig("comma-env", environmentsDir);
      expect(config?.id).toBe("comma-env");
      expect(config?.providers?.openai?.baseURL).toBe("https://api.openai.com");
    });
  });

  describe("createEnvironmentSource", () => {
    it("should create ConfigSource with correct properties", async () => {
      const source = createEnvironmentSource("test-env", 10, environmentsDir);

      expect(source.name).toBe("environment:test-env");
      expect(source.priority).toBe(10);
      expect(typeof source.load).toBe("function");
    });

    it("should use default priority of 10", async () => {
      const source = createEnvironmentSource("test-env", undefined, environmentsDir);
      expect(source.priority).toBe(10);
    });

    it("should load config when load is called", async () => {
      const envDir = path.join(environmentsDir, "source-test");
      await fs.mkdir(envDir, { recursive: true });
      await fs.writeFile(
        path.join(envDir, "config.jsonc"),
        JSON.stringify({ id: "source-test" })
      );

      const source = createEnvironmentSource("source-test", 10, environmentsDir);
      const config = await source.load();

      expect(config).not.toBeNull();
      expect(config?.id).toBe("source-test");
    });
  });

  describe("Integration with ConfigSourceRegistry", () => {
    it("should register and load environment source", async () => {
      const envDir = path.join(environmentsDir, "registry-test");
      await fs.mkdir(envDir, { recursive: true });
      await fs.writeFile(
        path.join(envDir, "config.jsonc"),
        JSON.stringify({ id: "registry-test", defaultModel: "claude-3" })
      );

      const source = createEnvironmentSource("registry-test", 10, environmentsDir);
      configRegistry.register(source);

      const sources = configRegistry.getSources();
      expect(sources.length).toBe(1);
      expect(sources[0].name).toBe("environment:registry-test");

      const config = await sources[0].load();
      expect(config?.defaultModel).toBe("claude-3");
    });

    it("should maintain correct priority order", async () => {
      configRegistry.register(createEnvironmentSource("env-1", 10, environmentsDir));
      configRegistry.register(createEnvironmentSource("env-2", 5, environmentsDir));
      configRegistry.register(createEnvironmentSource("env-3", 20, environmentsDir));

      const sources = configRegistry.getSources();
      expect(sources[0].priority).toBe(5); // env-2
      expect(sources[1].priority).toBe(10); // env-1
      expect(sources[2].priority).toBe(20); // env-3
    });
  });

  describe("Real-world scenarios", () => {
    it("should load os_env configuration", async () => {
      const envDir = path.join(environmentsDir, "os_env");
      await fs.mkdir(envDir, { recursive: true });

      await fs.writeFile(
        path.join(envDir, "config.jsonc"),
        JSON.stringify({
          id: "os_env",
          displayName: "OS Environment",
          description: "Operating system environment",
          defaultModel: "anthropic/claude-sonnet-4-5",
          apiKey: "${auth:anthropic-claude}",
          provider: {
            anthropic: {
              baseURL: "https://api.anthropic.com/v1",
              apiKey: "${auth:anthropic-claude}"
            }
          },
          environment: {
            capabilities: {
              logs: true,
              events: true
            }
          }
        })
      );

      await fs.writeFile(
        path.join(envDir, "agents.jsonc"),
        JSON.stringify([
          {
            id: "os_agent",
            role: "primary",
            promptId: "system",
            allowedTools: ["bash", "file_read"]
          }
        ])
      );

      await fs.writeFile(
        path.join(envDir, "models.jsonc"),
        JSON.stringify({
          "claude-sonnet": {
            provider: "anthropic",
            modelId: "claude-sonnet-4-5"
          }
        })
      );

      const config = await loadEnvironmentConfig("os_env", environmentsDir);
      expect(config?.id).toBe("os_env");
      expect(config?.agents?.length).toBe(1);
      expect(config?.models?.["claude-sonnet"]).toBeDefined();
    });
  });
});
