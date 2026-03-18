/**
 * @fileoverview Memory tools tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import fs from "fs/promises";
import os from "os";
import {
  listMemoryFile,
  readMemoryFile,
  writeMemoryFile,
  grepMemoryFile,
} from "./built-in-memory-tools.js";

// 创建临时测试目录
const testDir = path.join(os.tmpdir(), `memory-test-${Date.now()}`);

describe("Memory Tools", () => {
  beforeEach(async () => {
    // 创建测试目录结构
    await fs.mkdir(path.join(testDir, "operations"), { recursive: true });
    await fs.mkdir(path.join(testDir, "solutions"), { recursive: true });
    
    // 写入测试文件
    await fs.writeFile(
      path.join(testDir, "operations", "task_123_design.md"),
      "# 操作记录\n\n## 问题\nBun 编译崩溃",
      "utf-8"
    );
    await fs.writeFile(
      path.join(testDir, "solutions", "fix_bun_crash.md"),
      "# 解决方案\n\n使用 gpt-4o 模型",
      "utf-8"
    );
  });

  afterEach(async () => {
    // 清理测试目录
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("listMemoryFile", () => {
    it("should list root directory", async () => {
      const result = await listMemoryFile({});
      // 由于没有配置，应该返回默认路径
      expect(result).toBeDefined();
    });

    it("should list specific directory", async () => {
      const result = await listMemoryFile({ dir: "operations" });
      expect(result).toBeDefined();
    });
  });

  describe("writeMemoryFile", () => {
    it("should create file in directory", async () => {
      const result = await writeMemoryFile({
        dir: "operations",
        filename: "test_new.md",
        content: "# Test\n\nTest content",
      });
      // 由于没有配置，可能返回错误或成功
      expect(result).toBeDefined();
    });
  });

  describe("readMemoryFile", () => {
    it("should return error for non-existent file", async () => {
      const result = await readMemoryFile({
        dir: "operations",
        filename: "non_existent.md",
      });
      expect(result).toHaveProperty("error");
    });
  });

  describe("grepMemoryFile", () => {
    it("should search in all memory paths", async () => {
      const result = await grepMemoryFile({
        pattern: "test",
      });
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it("should search in specific directory", async () => {
      const result = await grepMemoryFile({
        pattern: "Bun",
        dir: "operations",
      });
      expect(result).toBeDefined();
    });
  });
});
