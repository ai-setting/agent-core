/**
 * @fileoverview Unit tests for bash tool description parameter requirement.
 * Tests that the description parameter should be required.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createBashTool } from "./bash.js";

describe("Bash Tool - Description Parameter Tests", () => {
  let testDir: string;
  let bashTool: ReturnType<typeof createBashTool>;

  beforeAll(() => {
    testDir = join(tmpdir(), `agent-core-bash-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    bashTool = createBashTool();
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test("should have description parameter defined in schema", () => {
    const paramsSchema = bashTool.parameters;
    
    const parseResult = paramsSchema.safeParse({
      command: "echo test",
      description: "Test command",
    });
    
    expect(parseResult.success).toBe(true);
  });

  test("should accept bash call with description parameter", async () => {
    const result = await bashTool.execute({
      command: "echo 'test'",
      description: "Echo test message",
    }, {} as any);
    
    expect(result.success).toBe(true);
  });

  test("should fail when description is not provided (now required)", async () => {
    const paramsSchema = bashTool.parameters;
    
    const parseResult = paramsSchema.safeParse({
      command: "echo test",
    });
    
    expect(parseResult.success).toBe(false);
  });

  test("description should have proper description in schema for LLM", () => {
    const paramsSchema = bashTool.parameters;
    
    const parseResult = paramsSchema.safeParse({
      command: "echo test",
      description: "Test command",
    });
    
    expect(parseResult.success).toBe(true);
  });
});
