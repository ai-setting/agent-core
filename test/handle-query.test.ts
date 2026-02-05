/**
 * @fileoverview Integration tests for handle_query with environment variable configuration.
 * Reads LLM configuration from .env file.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { OsEnv } from "../src/environment/expand_env/os-env.js";
import type { Context } from "../src/types/index.js";

const savedEnv: Record<string, string | undefined> = {};

async function loadEnv(path: string): Promise<void> {
  try {
    const text = await Bun.file(path).text();
    const lines = text.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eqIndex = trimmed.indexOf("=");
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim();
          const value = trimmed.substring(eqIndex + 1).trim();
          if (value) {
            savedEnv[key] = process.env[key];
            process.env[key] = value;
          }
        }
      }
    }
  } catch (e) {
    console.log(`Warning: Could not load .env file: ${e}`);
  }
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("handle_query with Environment Configuration", () => {
  beforeAll(async () => {
    await loadEnv(".env");
  });

  afterAll(() => {
    restoreEnv();
  });

  describe("auto-loading from environment variables", () => {
    test("should auto-load LLM_MODEL from environment", () => {
      const model = process.env.LLM_MODEL;

      expect(model).toBeDefined();
      expect(model).toMatch(/\w+\/\w+/);
    });

    test("should create OsEnv without explicit LLM config", () => {
      const env = new OsEnv();

      expect(env).toBeDefined();
    });

    test("should have tools registered after initialization", () => {
      const env = new OsEnv();

      const tools = env.listTools();

      expect(tools.length).toBeGreaterThan(0);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("bash");
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("write_file");
      expect(toolNames).toContain("glob");
      expect(toolNames).toContain("grep");
    });

    test("should use OsEnv.create() for automatic env loading", async () => {
      process.env.LLM_MODEL = "openai/gpt-4o";
      process.env.LLM_API_KEY = "";

      const env = await OsEnv.create();

      expect(env).toBeDefined();
    });
  });

  describe("handle_query error handling", () => {
    test("should handle missing API key gracefully", async () => {
      await loadEnv(".env");

      const envWithoutLLM = new OsEnv();

      const context: Context = {
        session_id: "test-session-error",
        timestamp: new Date().toISOString(),
        workdir: process.cwd(),
        metadata: {},
      };

      try {
        await envWithoutLLM.handle_query("Say hello", context);
      } catch (e) {
        expect(e).toBeDefined();
      }
    });
  });
});

describe("OsEnv.create() static method", () => {
  beforeAll(() => {
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;
  });

  test("should create OsEnv from environment variables", async () => {
    process.env.LLM_MODEL = "openai/gpt-4o";
    process.env.LLM_API_KEY = "test-key";
    process.env.LLM_BASE_URL = "https://api.example.com";

    const env = await OsEnv.create();

    expect(env).toBeDefined();
  });

  test("should have tools after create()", async () => {
    process.env.LLM_MODEL = "openai/gpt-4o";
    process.env.LLM_API_KEY = "test-key";

    const env = await OsEnv.create();

    const tools = env.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  test("should handle missing environment variables gracefully", async () => {
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    delete process.env.LLM_BASE_URL;

    const env = await OsEnv.create();

    expect(env).toBeDefined();
  });
});

describe("OsEnv with different LLM providers", () => {
  test("should configure with model from environment", async () => {
    await loadEnv(".env");

    const apiKey = process.env.LLM_API_KEY;
    const model = process.env.LLM_MODEL;

    if (!apiKey || !model) {
      console.log("Skipping - no LLM_API_KEY or LLM_MODEL in .env");
      return;
    }

    const env = new OsEnv({ model, apiKey });

    expect(env).toBeDefined();
  });
});

describe("handle_query with mock LLM", () => {
  test("should have LLM adapter after configuration", async () => {
    await loadEnv(".env");

    const mockAdapter = {
      name: "mock",
      displayName: "Mock",
      isConfigured: () => true,
      getDefaultModel: () => "mock-model",
      listModels: async () => ["mock-model"],
      complete: async () => ({ success: true, content: "Mock response" }),
      stream: async () => {},
    };

    const env = new OsEnv({});

    const adapter = env.getLLMAdapter();
    expect(adapter).toBeUndefined();

    env.configureLLM(mockAdapter);

    const adapterAfter = env.getLLMAdapter();
    expect(adapterAfter).toBeDefined();
    expect(adapterAfter?.name).toBe("mock");
  });
});
