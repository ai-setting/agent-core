import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { Paths_setTestHome, Paths_clearTestHome } from "../config/paths.js";
import { initWithEnvOverrides } from "../config/default-sources.js";
import { Config_get, Config_clear } from "../config/config.js";
import { findEnvironmentPath } from "../config/sources/environment.js";

describe("Project-level Environment with Relative Paths", () => {
  let tempDir: string;
  const originalCwd = process.cwd();

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "project-env-test-"));
    process.chdir(tempDir);
    Paths_setTestHome(tempDir);
    Config_clear();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    Paths_clearTestHome();
    // Clean up - delete the temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should load environment from project .tong_work folder", async () => {
    // 1. Create project structure
    const projectTongWorkDir = path.join(tempDir, ".tong_work");
    const envDir = path.join(projectTongWorkDir, "environments", "my-test-env");
    const mcpserversDir = path.join(envDir, "mcpservers");
    const skillsDir = path.join(envDir, "skills");
    
    await fs.mkdir(mcpserversDir, { recursive: true });
    await fs.mkdir(skillsDir, { recursive: true });

    // 2. Create tong_work.jsonc with local environment
    await fs.writeFile(
      path.join(projectTongWorkDir, "tong_work.jsonc"),
      JSON.stringify({
        activeEnvironment: "my-test-env",
        environmentSearchPaths: ["local", "global"]
      })
    );

    // 3. Create environment config.jsonc
    await fs.writeFile(
      path.join(envDir, "config.jsonc"),
      JSON.stringify({
        id: "my-test-env",
        displayName: "My Test Environment",
        description: "Test environment with local config",
        defaultModel: "claude-sonnet-4-5"
      })
    );

    // 4. Load configuration
    await initWithEnvOverrides();
    const config = await Config_get();

    // 5. Verify
    expect(config.activeEnvironment).toBe("my-test-env");
    expect(config.id).toBe("my-test-env");

    // 6. Verify environment path is found
    const envPath = await findEnvironmentPath("my-test-env", {
      searchPaths: ["local", "global"]
    });
    expect(envPath).not.toBeNull();
    expect(envPath?.source).toBe("local");
    expect(envPath?.path).toContain("my-test-env");
  });

  it("should find local environment before global", async () => {
    // 1. Create local environment
    const localEnvDir = path.join(tempDir, ".tong_work", "environments", "shared-env");
    await fs.mkdir(localEnvDir, { recursive: true });
    await fs.writeFile(
      path.join(localEnvDir, "config.jsonc"),
      JSON.stringify({ id: "shared-env", source: "local" })
    );

    // 2. Create global environment (in test home)
    const globalEnvDir = path.join(tempDir, ".config", "tong_work", "agent-core", "environments", "shared-env");
    await fs.mkdir(globalEnvDir, { recursive: true });
    await fs.writeFile(
      path.join(globalEnvDir, "config.jsonc"),
      JSON.stringify({ id: "shared-env", source: "global" })
    );

    // 3. Find environment - should find local first
    const result = await findEnvironmentPath("shared-env", {
      searchPaths: ["local", "global"]
    });

    expect(result).not.toBeNull();
    expect(result?.source).toBe("local");
  });

  it("should fallback to global when local not found", async () => {
    // 1. Create only global environment
    const globalEnvDir = path.join(tempDir, ".config", "tong_work", "agent-core", "environments", "global-only");
    await fs.mkdir(globalEnvDir, { recursive: true });
    await fs.writeFile(
      path.join(globalEnvDir, "config.jsonc"),
      JSON.stringify({ id: "global-only", source: "global" })
    );

    // 2. Find environment - should find global
    const result = await findEnvironmentPath("global-only", {
      searchPaths: ["local", "global"]
    });

    expect(result).not.toBeNull();
    expect(result?.source).toBe("global");
  });

  it("should resolve relative paths in MCP config", async () => {
    // 1. Create project structure with MCP config using relative path
    const projectTongWorkDir = path.join(tempDir, ".tong_work");
    const envDir = path.join(projectTongWorkDir, "environments", "mcp-test-env");
    const mcpserversDir = path.join(envDir, "mcpservers");
    
    await fs.mkdir(mcpserversDir, { recursive: true });

    // 2. Create tong_work.jsonc
    await fs.writeFile(
      path.join(projectTongWorkDir, "tong_work.jsonc"),
      JSON.stringify({
        activeEnvironment: "mcp-test-env"
      })
    );

    // 3. Create environment config with relative path in MCP command
    await fs.writeFile(
      path.join(envDir, "config.jsonc"),
      JSON.stringify({
        id: "mcp-test-env",
        displayName: "MCP Test Environment",
        mcp: {
          clients: {
            test_mcp: {
              type: "local",
              command: ["node", "mcpservers/test-mcp/index.js"],
              enabled: true
            }
          }
        }
      })
    );

    // 4. Create mock MCP server
    const testMcpDir = path.join(mcpserversDir, "test-mcp");
    await fs.mkdir(testMcpDir, { recursive: true });
    await fs.writeFile(
      path.join(testMcpDir, "index.js"),
      "console.log('Mock MCP server');",
      { encoding: "utf-8" }
    );

    // 5. Load configuration
    await initWithEnvOverrides();
    const config = await Config_get();

    // 6. Verify MCP config is loaded
    expect(config.mcp?.clients).toBeDefined();
    expect(config.mcp?.clients?.test_mcp).toBeDefined();
    
    // The relative path should be stored in config
    const mcpConfig = config.mcp?.clients?.test_mcp as any;
    expect(mcpConfig?.command).toBeDefined();
    expect(mcpConfig?.command[1]).toContain("mcpservers");
  });
});
