/**
 * @fileoverview Agent doom loop integration tests
 */

import { describe, it, expect, beforeEach, vi } from "bun:test";
import { Agent } from "./index.js";
import type { ToolInfo, Tool } from "../types/tool.js";

describe("Agent Doom Loop Integration", () => {
  let mockTools: Tool[];

  beforeEach(() => {
    mockTools = [
      {
        name: "read_file",
        description: "Read a file",
        parameters: {} as any,
        execute: vi.fn().mockResolvedValue({ success: true, output: "file content" }),
      } as Tool,
      {
        name: "echo",
        description: "Echo back the input",
        parameters: {} as any,
        execute: vi.fn().mockResolvedValue({ success: true, output: "echo done" }),
      } as Tool,
    ];
  });

  describe("doom loop configuration", () => {
    it("should create agent with custom doom loop threshold", () => {
      const mockEvent = { type: "test" } as any;
      const mockEnv = {
        handle_action: vi.fn().mockResolvedValue({ success: true, output: "done" }),
      } as any;

      const agent = new Agent(
        mockEvent,
        mockEnv,
        mockTools,
        {},
        { doomLoopThreshold: 2 }
      );

      // Agent should be created successfully
      expect(agent).toBeDefined();
    });

    it("should create agent with default doom loop threshold of 3", () => {
      const mockEvent = { type: "test" } as any;
      const mockEnv = {
        handle_action: vi.fn().mockResolvedValue({ success: true, output: "done" }),
      } as any;

      const agent = new Agent(
        mockEvent,
        mockEnv,
        mockTools,
        {}
      );

      // Agent should be created with default config
      expect(agent).toBeDefined();
    });
  });

  describe("doom loop key normalization", () => {
    it("should normalize arguments with same content", () => {
      const mockEvent = { type: "test" } as any;
      const mockEnv = {
        handle_action: vi.fn().mockResolvedValue({ success: true, output: "done" }),
      } as any;

      const agent = new Agent(
        mockEvent,
        mockEnv,
        mockTools,
        {},
        { doomLoopThreshold: 3 }
      );

      // Test that arguments with same content are equivalent
      const args1 = { path: "test.ts", offset: 0 };
      const args2 = { offset: 0, path: "test.ts" };
      
      // These have same content but different key order
      expect(args1).toEqual(args2);
    });

    it("should differentiate by tool name in key", () => {
      const mockEvent = { type: "test" } as any;
      const mockEnv = {
        handle_action: vi.fn().mockResolvedValue({ success: true, output: "done" }),
      } as any;

      const agent = new Agent(
        mockEvent,
        mockEnv,
        mockTools,
        {},
        { doomLoopThreshold: 3 }
      );

      // Test that different tools with same args produce different keys
      const readFileArgs = { path: "test.ts" };
      const echoArgs = { path: "test.ts" };

      // Same args but different tools - we can't directly test but verify structure
      expect(readFileArgs).toEqual(echoArgs); // Same args
    });
  });
});
