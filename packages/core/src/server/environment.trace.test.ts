/**
 * @fileoverview ServerEnvironment Trace Configuration tests
 * 
 * Tests that ServerEnvironment correctly initializes SpanCollector
 * based on trace configuration in tong_work.jsonc.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { ServerEnvironment } from "./environment.js";
import { getSpanCollector, setSpanCollector } from "../utils/span-collector.js";
import { Config_get, Config_clear, configRegistry, initDefaultSources, Config_getSync } from "../config/index.js";
import { Paths_setTestHome, Paths_clearTestHome, ConfigPaths } from "../config/paths.js";

describe("ServerEnvironment Trace Configuration", () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create temp directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "trace-config-test-"));
    
    // Set temp dir as test home using the test helper
    Paths_setTestHome(tempDir);
    
    // Create config directory structure
    await fs.mkdir(path.join(tempDir, ".config", "tong_work", "agent-core"), { recursive: true });
    
    // Clear config cache
    Config_clear();
    configRegistry.clear();
    
    // Reset SpanCollector
    setSpanCollector(null as any);
    
    // Debug: check the config path
    // console.log("Config path:", ConfigPaths.config);
  });

  afterEach(async () => {
    // Clear test home override
    Paths_clearTestHome();
    
    // Reset SpanCollector
    setSpanCollector(null as any);
    
    // Clean up temp dir (with retry for Windows race conditions)
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors on Windows
    }
  });

  it("should initialize SpanCollector when trace.enabled is true", async () => {
    // Create config file with trace enabled
    const configPath = path.join(tempDir, ".config", "tong_work", "agent-core", "tong_work.jsonc");
    await fs.writeFile(configPath, JSON.stringify({
      defaultModel: "test-model",
      trace: {
        enabled: true,
        recordParams: true,
        recordResult: false,
      },
    }));

    // Verify file was written
    // const writtenContent = await fs.readFile(configPath, "utf-8");

    // Initialize config sources
    initDefaultSources();
    await Config_get();

    // Verify config is loaded correctly
    const config = Config_getSync();
    // console.log("Loaded config:", JSON.stringify(config, null, 2));
    expect(config?.trace?.enabled).toBe(true);

    // Create ServerEnvironment - it will use the already loaded config
    const env = new ServerEnvironment({
      loadConfig: false,
    });

    // Manually trigger loadFromConfig to initialize trace
    await env.loadFromConfig();

    // Verify SpanCollector is initialized
    const collector = getSpanCollector();
    expect(collector).not.toBeNull();
  });

  it("should not initialize SpanCollector when trace.enabled is false", async () => {
    // Create config file with trace disabled
    const configPath = path.join(tempDir, ".config", "tong_work", "agent-core", "tong_work.jsonc");
    await fs.writeFile(configPath, JSON.stringify({
      defaultModel: "test-model",
      trace: {
        enabled: false,
      },
    }));

    // Initialize config sources
    initDefaultSources();
    await Config_get();

    // Verify config is loaded correctly
    const config = Config_getSync();
    expect(config?.trace?.enabled).toBe(false);

    // Create ServerEnvironment
    const env = new ServerEnvironment({
      loadConfig: false,
    });

    // Manually trigger loadFromConfig to initialize trace
    await env.loadFromConfig();

    // Verify SpanCollector is NOT initialized
    const collector = getSpanCollector();
    expect(collector).toBeNull();
  });

  it("should not initialize SpanCollector when trace config is missing", async () => {
    // Create config file without trace config
    const configPath = path.join(tempDir, ".config", "tong_work", "agent-core", "tong_work.jsonc");
    await fs.writeFile(configPath, JSON.stringify({
      defaultModel: "test-model",
    }));

    // Initialize config sources
    initDefaultSources();
    await Config_get();

    // Verify trace config is not set
    const config = Config_getSync();
    expect(config?.trace).toBeUndefined();

    // Create ServerEnvironment
    const env = new ServerEnvironment({
      loadConfig: false,
    });

    // Manually trigger loadFromConfig to initialize trace
    await env.loadFromConfig();

    // Verify SpanCollector is NOT initialized
    const collector = getSpanCollector();
    expect(collector).toBeNull();
  });

  it("should use default values when trace config is partial", async () => {
    // Create config file with only enabled: true
    const configPath = path.join(tempDir, ".config", "tong_work", "agent-core", "tong_work.jsonc");
    await fs.writeFile(configPath, JSON.stringify({
      defaultModel: "test-model",
      trace: {
        enabled: true,
        // Other fields not specified, should use defaults
      },
    }));

    // Initialize config sources
    initDefaultSources();
    await Config_get();

    // Verify config
    const config = Config_getSync();
    expect(config?.trace?.enabled).toBe(true);

    // Create ServerEnvironment
    const env = new ServerEnvironment({
      loadConfig: false,
    });

    // Manually trigger loadFromConfig to initialize trace
    await env.loadFromConfig();

    // Verify SpanCollector is initialized with defaults
    const collector = getSpanCollector();
    expect(collector).not.toBeNull();
  });
});
