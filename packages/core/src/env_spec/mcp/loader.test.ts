/**
 * @fileoverview MCP Loader 单元测试
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { McpServerLoader } from "./loader.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

describe("McpServerLoader", () => {
  let testDir: string;
  
  beforeEach(async () => {
    // 创建临时测试目录
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-test-"));
  });
  
  afterEach(async () => {
    // 清理测试目录
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {}
  });

  test("should return empty array for non-existent directory", async () => {
    const loader = new McpServerLoader("/non/existent/path");
    const result = await loader.discover();
    expect(result).toEqual([]);
  });

  test("should return empty array for empty directory", async () => {
    const loader = new McpServerLoader(testDir);
    const result = await loader.discover();
    expect(result).toEqual([]);
  });

  test("should discover server.mjs in subdirectory", async () => {
    // 创建测试目录结构
    const serverDir = path.join(testDir, "my-server");
    await fs.mkdir(serverDir);
    await fs.writeFile(path.join(serverDir, "server.mjs"), "console.log('hello')");
    
    const loader = new McpServerLoader(testDir);
    const result = await loader.discover();
    
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("my-server");
    expect(result[0].entryPath).toContain("server.mjs");
  });

  test("should discover server.ts in subdirectory", async () => {
    const serverDir = path.join(testDir, "ts-server");
    await fs.mkdir(serverDir);
    await fs.writeFile(path.join(serverDir, "server.ts"), "console.log('hello')");
    
    const loader = new McpServerLoader(testDir);
    const result = await loader.discover();
    
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("ts-server");
    expect(result[0].entryPath).toContain("server.ts");
  });

  test("should discover index.mjs in subdirectory", async () => {
    const serverDir = path.join(testDir, "index-server");
    await fs.mkdir(serverDir);
    await fs.writeFile(path.join(serverDir, "index.mjs"), "console.log('hello')");
    
    const loader = new McpServerLoader(testDir);
    const result = await loader.discover();
    
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("index-server");
    expect(result[0].entryPath).toContain("index.mjs");
  });

  test("should skip directories without entry script", async () => {
    const serverDir = path.join(testDir, "empty-server");
    await fs.mkdir(serverDir);
    // 不创建 server.mjs
    
    const loader = new McpServerLoader(testDir);
    const result = await loader.discover();
    
    expect(result).toHaveLength(0);
  });

  test("should discover multiple servers", async () => {
    // 创建多个服务器目录
    const server1Dir = path.join(testDir, "server1");
    const server2Dir = path.join(testDir, "server2");
    
    await fs.mkdir(server1Dir);
    await fs.mkdir(server2Dir);
    await fs.writeFile(path.join(server1Dir, "server.mjs"), "console.log('server1')");
    await fs.writeFile(path.join(server2Dir, "server.mjs"), "console.log('server2')");
    
    const loader = new McpServerLoader(testDir);
    const result = await loader.discover();
    
    expect(result).toHaveLength(2);
    const names = result.map(r => r.name).sort();
    expect(names).toEqual(["server1", "server2"]);
  });

  test("should detect config.jsonc if present", async () => {
    const serverDir = path.join(testDir, "config-server");
    await fs.mkdir(serverDir);
    await fs.writeFile(path.join(serverDir, "server.mjs"), "console.log('hello')");
    await fs.writeFile(path.join(serverDir, "config.jsonc"), "{ enabled: true }");
    
    const loader = new McpServerLoader(testDir);
    const result = await loader.discover();
    
    expect(result).toHaveLength(1);
    expect(result[0].configPath).toContain("config.jsonc");
  });

  test("should detect package.json if present", async () => {
    const serverDir = path.join(testDir, "package-server");
    await fs.mkdir(serverDir);
    await fs.writeFile(path.join(serverDir, "server.mjs"), "console.log('hello')");
    await fs.writeFile(path.join(serverDir, "package.json"), '{"name": "test"}');
    
    const loader = new McpServerLoader(testDir);
    const result = await loader.discover();
    
    expect(result).toHaveLength(1);
    expect(result[0].packagePath).toContain("package.json");
  });

  test("should ignore files in root directory", async () => {
    // 在根目录创建文件，不应该被发现
    await fs.writeFile(path.join(testDir, "server.mjs"), "console.log('hello')");
    
    const loader = new McpServerLoader(testDir);
    const result = await loader.discover();
    
    expect(result).toHaveLength(0);
  });

  test("should discover index.js in subdirectory", async () => {
    const serverDir = path.join(testDir, "js-server");
    await fs.mkdir(serverDir);
    await fs.writeFile(path.join(serverDir, "index.js"), "console.log('hello')");
    
    const loader = new McpServerLoader(testDir);
    const result = await loader.discover();
    
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("js-server");
    expect(result[0].entryPath).toContain("index.js");
  });

  test("should discover src/index.js entry script", async () => {
    const serverDir = path.join(testDir, "src-server");
    const srcDir = path.join(serverDir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "index.js"), "console.log('hello')");
    
    const loader = new McpServerLoader(testDir);
    const result = await loader.discover();
    
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("src-server");
    expect(result[0].entryPath).toMatch(/src[\\\/]index\.js$/);
  });

  test("should discover src/index.ts entry script", async () => {
    const serverDir = path.join(testDir, "src-ts-server");
    const srcDir = path.join(serverDir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "index.ts"), "console.log('hello')");
    
    const loader = new McpServerLoader(testDir);
    const result = await loader.discover();
    
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("src-ts-server");
    expect(result[0].entryPath).toMatch(/src[\\\/]index\.ts$/);
  });

  test("should prefer root entry over src entry", async () => {
    const serverDir = path.join(testDir, "mixed-server");
    const srcDir = path.join(serverDir, "src");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(serverDir, "index.js"), "console.log('root')");
    await fs.writeFile(path.join(srcDir, "index.js"), "console.log('src')");
    
    const loader = new McpServerLoader(testDir);
    const result = await loader.discover();
    
    expect(result).toHaveLength(1);
    expect(result[0].entryPath).toContain("index.js");
    expect(result[0].entryPath).not.toContain("src");
  });

  describe("loadServerConfig", () => {
    test("should load config.jsonc with environment variables", async () => {
      const serverDir = path.join(testDir, "config-server");
      await fs.mkdir(serverDir);
      await fs.writeFile(path.join(serverDir, "server.mjs"), "console.log('hello')");
      await fs.writeFile(
        path.join(serverDir, "config.jsonc"),
        `{
  "enabled": true,
  "timeout": 30000,
  "environment": {
    "API_URL": "https://api.example.com",
    "API_KEY": "secret-key"
  }
}`
      );
      
      const loader = new McpServerLoader(testDir);
      const config = await loader.loadServerConfig(serverDir);
      
      expect(config).not.toBeNull();
      expect(config?.enabled).toBe(true);
      expect(config?.timeout).toBe(30000);
      expect(config?.environment?.API_URL).toBe("https://api.example.com");
      expect(config?.environment?.API_KEY).toBe("secret-key");
    });

    test("should load config.jsonc with custom command", async () => {
      const serverDir = path.join(testDir, "cmd-server");
      await fs.mkdir(serverDir);
      await fs.writeFile(path.join(serverDir, "server.mjs"), "console.log('hello')");
      await fs.writeFile(
        path.join(serverDir, "config.jsonc"),
        JSON.stringify({
          command: ["node", "--experimental-modules", "./server.mjs"]
        }, null, 2)
      );
      
      const loader = new McpServerLoader(testDir);
      const config = await loader.loadServerConfig(serverDir);
      
      expect(config).not.toBeNull();
      expect(config?.command).toEqual(["node", "--experimental-modules", "./server.mjs"]);
    });

    test("should return null for missing config.jsonc", async () => {
      const serverDir = path.join(testDir, "no-config-server");
      await fs.mkdir(serverDir);
      await fs.writeFile(path.join(serverDir, "server.mjs"), "console.log('hello')");
      
      const loader = new McpServerLoader(testDir);
      const config = await loader.loadServerConfig(serverDir);
      
      expect(config).toBeNull();
    });

    test("should parse JSONC with comments", async () => {
      const serverDir = path.join(testDir, "jsonc-server");
      await fs.mkdir(serverDir);
      await fs.writeFile(path.join(serverDir, "server.mjs"), "console.log('hello')");
      await fs.writeFile(
        path.join(serverDir, "config.jsonc"),
        `{
          // This is a comment
          "enabled": true,
          /* Multi-line
             comment */
          "timeout": 30000
        }`
      );
      
      const loader = new McpServerLoader(testDir);
      const config = await loader.loadServerConfig(serverDir);
      
      expect(config).not.toBeNull();
      expect(config?.enabled).toBe(true);
      expect(config?.timeout).toBe(30000);
    });
  });
});
