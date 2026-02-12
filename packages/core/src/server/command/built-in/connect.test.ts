/**
 * @fileoverview Connect Command 单元测试
 *
 * 验证 Connect Command 的各种操作：
 * - list: 列出所有 providers
 * - add: 添加自定义 provider
 * - set_key: 设置 API key
 * - remove: 移除 provider
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { connectCommand } from "../built-in/connect.js";
import type { CommandContext } from "../types.js";
import * as AuthModule from "../../../config/auth.js";

describe("Connect Command", () => {
  const mockContext: CommandContext = {
    sessionId: "test-session",
    env: {} as any,
  };

  // Mock auth config storage
  let mockAuthConfig: Record<string, any> = {};
  let authGetSpy: any;
  let authListSpy: any;
  let authSetSpy: any;
  let authRemoveSpy: any;
  let authGetProviderSpy: any;

  beforeEach(() => {
    // Reset mock config
    mockAuthConfig = {};

    // Setup spies
    authGetSpy = spyOn(AuthModule, "Auth_get").mockImplementation(async () => mockAuthConfig);
    authListSpy = spyOn(AuthModule, "Auth_listProviders").mockImplementation(async () => Object.keys(mockAuthConfig));
    authSetSpy = spyOn(AuthModule, "Auth_setProvider").mockImplementation(async (id: string, config: any) => {
      mockAuthConfig[id] = config;
    });
    authRemoveSpy = spyOn(AuthModule, "Auth_removeProvider").mockImplementation(async (id: string) => {
      delete mockAuthConfig[id];
    });
    authGetProviderSpy = spyOn(AuthModule, "Auth_getProvider").mockImplementation(async (id: string) => mockAuthConfig[id]);
  });

  afterEach(() => {
    // Restore all spies
    authGetSpy?.mockRestore();
    authListSpy?.mockRestore();
    authSetSpy?.mockRestore();
    authRemoveSpy?.mockRestore();
    authGetProviderSpy?.mockRestore();
  });

  describe("list action", () => {
    it("should list all built-in providers when no providers configured", async () => {
      const result = await connectCommand.execute(mockContext, JSON.stringify({ type: "list" }));

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray((result.data as any).providers)).toBe(true);
      expect((result.data as any).providers.length).toBeGreaterThan(0);
      
      // 检查是否包含内置 providers
      const providerIds = (result.data as any).providers.map((p: any) => p.id);
      expect(providerIds).toContain("anthropic");
      expect(providerIds).toContain("openai");
      expect(providerIds).toContain("custom");
    });

    it("should mark providers as configured when they have API keys", async () => {
      // 先设置一个 provider
      mockAuthConfig["anthropic"] = {
        type: "api",
        key: "test-api-key",
        metadata: { displayName: "Anthropic" },
      };

      const result = await connectCommand.execute(mockContext, JSON.stringify({ type: "list" }));

      expect(result.success).toBe(true);
      const providers = (result.data as any).providers;
      const anthropic = providers.find((p: any) => p.id === "anthropic");
      expect(anthropic).toBeDefined();
      expect(anthropic.hasKey).toBe(true);
    });

    it("should include custom providers in the list", async () => {
      // 添加一个自定义 provider
      mockAuthConfig["my-custom"] = {
        type: "api",
        key: "custom-key",
        baseURL: "https://api.custom.com/v1",
        metadata: { displayName: "My Custom Provider" },
      };

      const result = await connectCommand.execute(mockContext, JSON.stringify({ type: "list" }));

      expect(result.success).toBe(true);
      const providers = (result.data as any).providers;
      const custom = providers.find((p: any) => p.id === "my-custom");
      expect(custom).toBeDefined();
      expect(custom.name).toBe("My Custom Provider");
      expect(custom.hasKey).toBe(true);
    });
  });

  describe("add action", () => {
    it("should add a custom provider", async () => {
      const result = await connectCommand.execute(
        mockContext,
        JSON.stringify({
          type: "add",
          providerId: "custom-provider",
          providerName: "Custom Provider",
          baseURL: "https://api.example.com/v1",
        })
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("added successfully");
      
      // 验证 provider 已被添加
      expect(mockAuthConfig["custom-provider"]).toBeDefined();
      expect(mockAuthConfig["custom-provider"].metadata.displayName).toBe("Custom Provider");
    });

    it("should fail when providerId is missing", async () => {
      const result = await connectCommand.execute(
        mockContext,
        JSON.stringify({
          type: "add",
          providerName: "Custom Provider",
        })
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Missing providerId");
    });

    it("should fail when providerName is missing", async () => {
      const result = await connectCommand.execute(
        mockContext,
        JSON.stringify({
          type: "add",
          providerId: "custom-provider",
        })
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Missing providerId or providerName");
    });
  });

  describe("set_key action", () => {
    it("should set API key for a provider", async () => {
      // 先添加一个 provider
      mockAuthConfig["test-provider"] = {
        type: "api",
        key: "",
        metadata: { displayName: "Test Provider" },
      };

      const result = await connectCommand.execute(
        mockContext,
        JSON.stringify({
          type: "set_key",
          providerId: "test-provider",
          apiKey: "new-api-key-123",
        })
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("API key set");
      
      // 验证 API key 已设置
      expect(authSetSpy).toHaveBeenCalled();
    });

    it("should fail when providerId is missing", async () => {
      const result = await connectCommand.execute(
        mockContext,
        JSON.stringify({
          type: "set_key",
          apiKey: "test-key",
        })
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Missing providerId");
    });

    it("should fail when apiKey is missing", async () => {
      const result = await connectCommand.execute(
        mockContext,
        JSON.stringify({
          type: "set_key",
          providerId: "test-provider",
        })
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Missing providerId or apiKey");
    });
  });

  describe("remove action", () => {
    it("should remove a provider", async () => {
      // 先添加一个 provider
      mockAuthConfig["provider-to-remove"] = {
        type: "api",
        key: "test-key",
        metadata: { displayName: "To Remove" },
      };

      const result = await connectCommand.execute(
        mockContext,
        JSON.stringify({
          type: "remove",
          providerId: "provider-to-remove",
        })
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("removed successfully");
      expect(authRemoveSpy).toHaveBeenCalledWith("provider-to-remove");
    });

    it("should fail when providerId is missing", async () => {
      const result = await connectCommand.execute(
        mockContext,
        JSON.stringify({
          type: "remove",
        })
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Missing providerId");
    });
  });

  describe("invalid action", () => {
    it("should return error for unknown action type", async () => {
      const result = await connectCommand.execute(
        mockContext,
        JSON.stringify({
          type: "unknown_action",
        })
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Unknown action type");
    });

    it("should return error for invalid JSON args", async () => {
      const result = await connectCommand.execute(mockContext, "invalid json");

      expect(result.success).toBe(false);
      expect(result.message).toContain("Invalid arguments");
    });
  });

  describe("default list action", () => {
    it("should default to list when no args provided", async () => {
      const result = await connectCommand.execute(mockContext, "");

      expect(result.success).toBe(true);
      expect((result.data as any).providers).toBeDefined();
    });
  });
});
