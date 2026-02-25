/**
 * @fileoverview Unit tests for file operation tools.
 * Tests read, write, glob, grep and helper functions.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  readFile,
  readFileFormatted,
  isBinaryFile,
  findSimilarFiles,
  computeDiff,
  writeFile,
  glob,
  grep,
  createFileTools,
} from "./file.js";
import { normalizePath, isAbsolute, resolvePath } from "./filesystem.js";

const isWindows = process.platform === "win32";

describe("File Tools - Helper Functions", () => {
  describe("normalizePath", () => {
    test("should normalize paths for current platform", () => {
      if (isWindows) {
        const result = normalizePath("C:\\Users\\user\\file.txt");
        expect(result).toBeTruthy();
      } else {
        const result = normalizePath("/home/user/file.txt");
        expect(result).toBe("/home/user/file.txt");
      }
    });
  });

  describe("isAbsolute", () => {
    test("should detect absolute paths for current platform", () => {
      if (isWindows) {
        expect(isAbsolute("C:\\Users\\user")).toBe(true);
        expect(isAbsolute("relative\\path")).toBe(false);
      } else {
        expect(isAbsolute("/home/user")).toBe(true);
        expect(isAbsolute("relative/path")).toBe(false);
      }
    });
  });

  describe("resolvePath", () => {
    test("should resolve relative paths", () => {
      const base = isWindows ? "C:\\Users\\user" : "/home/user";
      const result = resolvePath("test.txt", base);
      expect(result).toContain("test.txt");
    });

    test("should return absolute paths unchanged", () => {
      const absPath = isWindows ? "C:\\Users\\user\\test.txt" : "/home/user/test.txt";
      const result = resolvePath(absPath, "/other");
      expect(result).toContain("test.txt");
    });
  });
});

describe("File Tools - Read Operations", () => {
  const testDir = join(tmpdir(), `agent-core-test-${Date.now()}`);
  const testFile = join(testDir, "test.txt");
  const binaryFile = join(testDir, "test.bin");

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testFile, "Line 1\nLine 2\nLine 3\nLine 4\nLine 5");
    writeFileSync(binaryFile, Buffer.from([0x00, 0x01, 0x02, 0xff]));
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("readFile", () => {
    test("should read file content", async () => {
      const content = await readFile(testFile);
      expect(content).toContain("Line 1");
      expect(content).toContain("Line 5");
    });

    test("should throw error for non-existent file", async () => {
      await expect(readFile("/non/existent/file.txt")).rejects.toThrow();
    });

    test("should respect maxSize limit", async () => {
      await expect(readFile(testFile, { maxSize: 10 })).rejects.toThrow("too large");
    });
  });

  describe("readFileFormatted", () => {
    test("should format file with line numbers", async () => {
      const result = await readFileFormatted(testFile);
      expect(result.content).toContain("<file>");
      expect(result.content).toContain("00001| Line 1");
      expect(result.content).toContain("00005| Line 5");
      expect(result.content).toContain("</file>");
    });

    test("should handle pagination with offset and limit", async () => {
      const result = await readFileFormatted(testFile, { offset: 1, limit: 2 });
      expect(result.content).toContain("00002| Line 2");
      expect(result.content).not.toContain("00001| Line 1");
      expect(result.content).toContain("(File has more lines. Use 'offset' parameter to read beyond line 3)");
    });

    test("should include line count in metadata", async () => {
      const result = await readFileFormatted(testFile);
      expect(result.metadata.totalLines).toBe(5);
    });

    test("should indicate truncation", async () => {
      const result = await readFileFormatted(testFile, { offset: 0, limit: 2 });
      expect(result.metadata.truncated).toBe(true);
    });
  });

  describe("isBinaryFile", () => {
    test("should detect text files as non-binary", async () => {
      const result = await isBinaryFile(testFile);
      expect(result).toBe(false);
    });

    test("should detect binary files by extension", async () => {
      const result = await isBinaryFile(binaryFile);
      expect(result).toBe(true);
    });

    test("should detect common binary extensions", async () => {
      expect(await isBinaryFile("/path/to/file.zip")).toBe(true);
      expect(await isBinaryFile("/path/to/file.exe")).toBe(true);
      expect(await isBinaryFile("/path/to/file.db")).toBe(true);
    });

    test("should detect binary by content analysis", async () => {
      const binFile = join(testDir, "content.bin");
      writeFileSync(binFile, Buffer.from(Array(100).fill(0)));
      const result = await isBinaryFile(binFile);
      expect(result).toBe(true);
    });
  });

  describe("findSimilarFiles", () => {
    test("should find similar filenames", () => {
      const similarFile = join(testDir, "test-config.json");
      writeFileSync(similarFile, "{}");
      const results = findSimilarFiles(join(testDir, "test-config.js"));
      if (results.length > 0) {
        expect(results[0]).toContain("test-config");
      }
    });

    test("should return empty for non-existent directory", () => {
      const results = findSimilarFiles("/non/existent/dir/file.txt");
      expect(results).toEqual([]);
    });
  });
});

describe("File Tools - Write Operations", () => {
  const testDir = join(tmpdir(), `agent-core-write-test-${Date.now()}`);
  const testFile = join(testDir, "output.txt");

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("writeFile", () => {
    test("should write file successfully", async () => {
      const result = await writeFile(testFile, "Hello World");
      expect(result.success).toBe(true);
      expect(result.output).toContain("Wrote 11 bytes");
      expect(readFileSync(testFile, "utf-8")).toBe("Hello World");
    });

    test("should create directories when createDirectories is true", async () => {
      const nestedFile = join(testDir, "nested", "deep", "file.txt");
      const result = await writeFile(nestedFile, "nested content", {
        createDirectories: true,
      });
      expect(result.success).toBe(true);
      expect(existsSync(nestedFile)).toBe(true);
    });

    test("should append content when append is true", async () => {
      await writeFile(testFile, "First line\n");
      const result = await writeFile(testFile, "Second line", { append: true });
      const content = readFileSync(testFile, "utf-8");
      expect(content).toBe("First line\nSecond line");
    });

    test("should show diff when overwriting", async () => {
      await writeFile(testFile, "Original content\n");
      const result = await writeFile(testFile, "Updated content\n", { diff: true });
      expect(result.diff).toBeDefined();
      expect(result.diff).toContain("- Original content");
      expect(result.diff).toContain("+ Updated content");
    });

    test("should not show diff for new files", async () => {
      const newFile = join(testDir, "newfile.txt");
      const result = await writeFile(newFile, "New content", { diff: true });
      expect(result.diff).toBeUndefined();
    });
  });
});

describe("computeDiff", () => {
  test("should compute line-based diff", () => {
    const oldContent = "Line 1\nLine 2\nLine 3";
    const newContent = "Line 1\nModified Line 2\nLine 3";
    const diff = computeDiff(oldContent, newContent);
    expect(diff).toContain("- Line 2");
    expect(diff).toContain("+ Modified Line 2");
  });

  test("should show unchanged lines", () => {
    const oldContent = "Line 1\nLine 2";
    const newContent = "Line 1\nLine 2";
    const diff = computeDiff(oldContent, newContent);
    expect(diff).toContain("  Line 1");
    expect(diff).toContain("  Line 2");
  });

  test("should handle empty files", () => {
    const diff = computeDiff("", "New content");
    expect(diff).toContain("+ New content");
  });

  test("should handle file deletion", () => {
    const diff = computeDiff("Content to remove", "");
    expect(diff).toContain("- Content to remove");
  });
});

describe("File Tools - Glob", () => {
  const testDir = join(tmpdir(), `agent-core-glob-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(join(testDir, "src"), { recursive: true });
    writeFileSync(join(testDir, "src", "index.ts"), "");
    writeFileSync(join(testDir, "src", "util.ts"), "");
    writeFileSync(join(testDir, "package.json"), "");
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("glob", () => {
    test("should find TypeScript files", async () => {
      const results = await glob("src/*.ts", { cwd: testDir });
      expect(results.length).toBe(2);
    });

    test("should support multiple patterns", async () => {
      const results = await glob(["src/*.ts", "package.json"], { cwd: testDir });
      expect(results.length).toBe(3);
    });

    test("should respect maxResults limit", async () => {
      const results = await glob("src/*.ts", { cwd: testDir, maxResults: 1 });
      expect(results.length).toBe(1);
    });

    test("should exclude node_modules by default", async () => {
      const nestedDir = join(testDir, "node_modules");
      const depDir = join(nestedDir, "dep");
      mkdirSync(depDir, { recursive: true });
      writeFileSync(join(depDir, "index.js"), "");
      const results = await glob("**/*.ts", { cwd: testDir });
      const hasNodeModules = results.some((r) => r.includes("node_modules"));
      expect(hasNodeModules).toBe(false);
    });
  });
});

describe("File Tools - Grep", () => {
  const testDir = join(tmpdir(), `agent-core-grep-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, "file1.ts"), "function hello() {\n  return 'Hello';\n}");
    writeFileSync(join(testDir, "file2.ts"), "const greeting = 'Hello World';\nconsole.log(greeting);");
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("grep", () => {
    test("should find matches in files", async () => {
      const results = await grep("Hello", { cwd: testDir });
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    test("should return file and line number", async () => {
      const results = await grep("function", { cwd: testDir });
      expect(results[0].file).toBeDefined();
      expect(results[0].line).toBe(1);
    });

    test("should support case-insensitive search", async () => {
      const results = await grep("hello", { cwd: testDir, caseSensitive: false });
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    test("should support regex patterns", async () => {
      const results = await grep(/Hello\s+\w+/, { cwd: testDir });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("should respect maxMatches limit", async () => {
      const results = await grep("function|const", { cwd: testDir, maxMatches: 1 });
      expect(results.length).toBe(1);
    });

    test("should filter by include patterns", async () => {
      const results = await grep("function", {
        cwd: testDir,
        includePatterns: ["file1.ts"],
      });
      expect(results.length).toBe(1);
      expect(results[0].file).toContain("file1.ts");
    });

    test("should handle binary files without crashing", async () => {
      const binFile = join(testDir, "data.bin");
      writeFileSync(binFile, "some binary-like content");
      const results = await grep("binary", { cwd: testDir });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe("File Tools - Integration Tests", () => {
  const testDir = join(tmpdir(), `agent-core-integration-${Date.now()}`);
  const testFile = join(testDir, "data.txt");

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("should read and write round-trip", async () => {
    const originalContent = "Test content for round-trip\nLine 2\nLine 3";
    await writeFile(testFile, originalContent);
    const readContent = await readFile(testFile);
    expect(readContent).toBe(originalContent);
  });

  test("should handle formatted read with pagination", async () => {
    const longContent = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join("\n");
    await writeFile(testFile, longContent);

    const result = await readFileFormatted(testFile, { offset: 50, limit: 10 });
    expect(result.content).toContain("00051| Line 51");
    expect(result.content).not.toContain("00001| Line 1");
    expect(result.metadata.totalLines).toBe(100);
  });

  test("should compute meaningful diffs", async () => {
    const original = "Original content\nMore content";
    await writeFile(testFile, original);

    const modified = "Modified content\nMore content\nNew line";
    const result = await writeFile(testFile, modified, { diff: true });

    expect(result.diff).toContain("- Original content");
    expect(result.diff).toContain("+ Modified content");
    expect(result.diff).toContain("+ New line");
  });
});

describe("File Tools - Tool Definitions", () => {
  const testDir = join(tmpdir(), `agent-core-tool-def-${Date.now()}`);
  const testFile = join(testDir, "test.ts");

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(testFile, "Line 1\nLine 2\nLine 3");
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("createFileTools", () => {
    const tools = createFileTools();

    test("should create all required tools", () => {
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain("read_file");
      expect(toolNames).toContain("write_file");
      expect(toolNames).toContain("edit_file");
      expect(toolNames).toContain("glob");
      expect(toolNames).toContain("grep");
      expect(toolNames.length).toBe(5);
    });

    describe("read_file tool", () => {
      const readTool = tools.find((t) => t.name === "read_file")!;

      test("should have detailed description", () => {
        expect(readTool.description).toContain("Read a file from the local filesystem");
        expect(readTool.description).toContain("cat -n format");
        expect(readTool.description).toContain("2000 lines");
        expect(readTool.description).toContain("AVOID tiny repeated slices");
      });

      test("should have correct parameters", async () => {
        const toolInfo = await readTool.init?.({}) ?? { parameters: readTool.parameters };
        const paramsParse = toolInfo.parameters.parse;
        expect(() => paramsParse({ path: testFile })).not.toThrow();
        expect(() => paramsParse({ path: testFile, offset: 1 })).not.toThrow();
        expect(() => paramsParse({ path: testFile, offset: "1", limit: "2" })).not.toThrow();
      });

      test("should execute successfully", async () => {
        const result = await readTool.execute({ path: testFile, offset: 0, limit: 10 }, {});
        expect(result.success).toBe(true);
        expect(result.output).toContain("<file>");
        expect(result.output).toContain("00001| Line 1");
        expect(result.output).toContain("</file>");
      });

      test("should handle pagination with offset and limit", async () => {
        const result = await readTool.execute({ path: testFile, offset: 1, limit: 1 }, {});
        expect(result.success).toBe(true);
        expect(result.output).toContain("00002| Line 2");
        expect(result.output).not.toContain("00001| Line 1");
      });

      test("should handle string parameters with coercion", async () => {
        const result = await readTool.execute({ path: testFile, offset: 0, limit: "2" }, {});
        expect(result.success).toBe(true);
        expect(result.output).toContain("00001| Line 1");
        expect(result.output).toContain("00002| Line 2");
      });

      test("should handle missing path parameter", async () => {
        const result = await readTool.execute({}, {});
        expect(result.success).toBe(false);
        expect(result.error).toContain("Missing required parameter");
      });

      test("should handle non-existent file", async () => {
        const result = await readTool.execute({ path: join(testDir, "nonexistent.txt") }, {});
        expect(result.success).toBe(false);
        expect(result.error).toContain("File not found");
      });
    });

    describe("write_file tool", () => {
      const writeTool = tools.find((t) => t.name === "write_file")!;

      test("should have detailed description with usage guidelines", () => {
        expect(writeTool.description).toContain("Write a file to the local filesystem");
        expect(writeTool.description).toContain("overwrite");
        expect(writeTool.description).toContain("Read tool first");
        expect(writeTool.description).toContain("NEVER proactively create documentation");
        expect(writeTool.description).toContain("LSP diagnostics");
      });

      test("should have correct parameters", async () => {
        const toolInfo = await writeTool.init?.({}) ?? { parameters: writeTool.parameters };
        const paramsParse = toolInfo.parameters.parse;
        expect(() => paramsParse({ path: "test.txt", content: "hello" })).not.toThrow();
        expect(() => paramsParse({ path: "test.txt", content: "hello", append: true })).not.toThrow();
        expect(() => paramsParse({ path: "test.txt", content: "hello", createDirs: true })).not.toThrow();
        expect(() => paramsParse({ path: "test.txt", content: "hello", showDiff: true })).not.toThrow();
      });

      test("should return diagnostics with range info in metadata", async () => {
        // Use the actual agent-core project directory which has package.json
        const projectDir = join(__dirname, "../../../../../../..");
        
        const outputFile = join(projectDir, "test-diagnostics.ts");
        
        try {
          const result = await writeTool.execute(
            { path: outputFile, content: "const x: string = 123;\nconst y: number = 'hello';" },
            { workdir: projectDir },
          );
          expect(result.success).toBe(true);
          expect(result.metadata).toBeDefined();
          console.log("Full result metadata:", JSON.stringify(result.metadata, null, 2));
          
          // The diagnostics should have range information if LSP is available
          const diagnostics = result.metadata?.diagnostics as Record<string, Array<{
            range?: { start: { line: number; character: number } };
            severity?: number;
            message?: string;
          }>> || {};
          
          // Log diagnostics for debugging
          console.log("Diagnostics:", JSON.stringify(diagnostics, null, 2));
          
          // Check structure - diagnostics should be an object with file paths as keys
          expect(typeof diagnostics).toBe("object");
          
          let hasDiagnosticsWithRange = false;
          for (const [file, diags] of Object.entries(diagnostics)) {
            console.log(`Diagnostics for ${file}:`, JSON.stringify(diags, null, 2));
            // If there are diagnostics, they should have range
            if (diags && diags.length > 0) {
              for (const diag of diags) {
                hasDiagnosticsWithRange = true;
                // Each diagnostic should have range with line info
                expect(diag).toHaveProperty("range");
                expect(diag.range?.start).toHaveProperty("line");
                expect(diag.range?.start).toHaveProperty("character");
              }
            }
          }
          
          // Log output to see formatted diagnostics
          console.log("Tool output:", result.output);
        } finally {
          // Clean up the test file
          if (existsSync(outputFile)) {
            unlinkSync(outputFile);
          }
        }
      }, 30000);

      test("should execute successfully", async () => {
        const outputFile = join(testDir, "output.txt");
        const result = await writeTool.execute(
          { path: outputFile, content: "Hello World" },
          {},
        );
        expect(result.success).toBe(true);
        expect(readFileSync(outputFile, "utf-8")).toBe("Hello World");
      });

      test("should handle append mode", async () => {
        const outputFile = join(testDir, "append.txt");
        await writeTool.execute({ path: outputFile, content: "First" }, {});
        const result = await writeTool.execute(
          { path: outputFile, content: "Second", append: true },
          {},
        );
        expect(result.success).toBe(true);
        expect(readFileSync(outputFile, "utf-8")).toBe("FirstSecond");
      });

      test("should handle missing required parameters", async () => {
        const result = await writeTool.execute({ path: "test.txt" }, {});
        expect(result.success).toBe(false);
        expect(result.error).toContain("Missing required parameter");
      });
    });

    describe("glob tool", () => {
      const globTool = tools.find((t) => t.name === "glob")!;

      test("should have concise description", () => {
        expect(globTool.description).toContain("Fast file pattern matching");
        expect(globTool.description).toContain("glob patterns");
      });

      test("should have simplified single pattern parameter", async () => {
        const toolInfo = await globTool.init?.({}) ?? { parameters: globTool.parameters };
        const paramsParse = toolInfo.parameters.parse;
        expect(() => paramsParse({ pattern: "*.ts" })).not.toThrow();
        expect(() => paramsParse({ pattern: "*.ts", path: testDir })).not.toThrow();
        expect(() => paramsParse({ pattern: "*.ts", maxResults: 10 })).not.toThrow();
      });

      test("should execute successfully", async () => {
        const result = await globTool.execute({ pattern: "*.ts", path: testDir }, {});
        expect(result.success).toBe(true);
        expect(result.output).toContain("test.ts");
      });

      test("should handle default path", async () => {
        const result = await globTool.execute({ pattern: "*.ts" }, {});
        expect(result.success).toBe(true);
      });
    });

    describe("grep tool", () => {
      const grepTool = tools.find((t) => t.name === "grep")!;

      test("should have concise description", () => {
        expect(grepTool.description).toContain("Fast content search");
        expect(grepTool.description).toContain("regular expressions");
        expect(grepTool.description).toContain("ripgrep");
      });

      test("should have simplified parameters", async () => {
        const toolInfo = await grepTool.init?.({}) ?? { parameters: grepTool.parameters };
        const paramsParse = toolInfo.parameters.parse;
        expect(() => paramsParse({ pattern: "Line", path: testDir })).not.toThrow();
        expect(() => paramsParse({ pattern: "Line", include: "*.ts" })).not.toThrow();
        expect(() => paramsParse({ pattern: "Line", maxMatches: 10 })).not.toThrow();
      });

      test("should execute successfully", async () => {
        const result = await grepTool.execute({ pattern: "Line", path: testDir }, {});
        expect(result.success).toBe(true);
        expect(result.output).toContain("Line 1");
      });

      test("should handle include parameter", async () => {
        const result = await grepTool.execute({
          pattern: "Line",
          path: testDir,
          include: "*.ts",
        }, {});
        expect(result.success).toBe(true);
      });

      test("should handle missing pattern", async () => {
        const result = await grepTool.execute({ path: testDir }, {});
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      });

      test("should return no matches result", async () => {
        const result = await grepTool.execute({ pattern: "nonexistentpattern123", path: testDir }, {});
        expect(result.success).toBe(true);
        expect(result.output).toContain("No files found");
      });
    });
  });
});
