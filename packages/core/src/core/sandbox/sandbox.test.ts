import { describe, it, expect, beforeEach, vi, afterEach } from "bun:test";
import { NativeSandboxProvider } from "./implementations/native-sandbox.js";
import type { SandboxConfig } from "./types.js";

// Mock @anthropic-ai/sandbox-runtime
vi.mock("@anthropic-ai/sandbox-runtime", () => ({
  SandboxManager: {
    initialize: vi.fn().mockResolvedValue(undefined),
    isSandboxingEnabled: vi.fn().mockReturnValue(false),
    wrapWithSandbox: vi.fn().mockImplementation((cmd: string) => Promise.resolve(`sandboxed: ${cmd}`)),
    reset: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("NativeSandboxProvider", () => {
  let provider: NativeSandboxProvider;

  beforeEach(() => {
    provider = new NativeSandboxProvider();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await provider.cleanup();
  });

  describe("type", () => {
    it("should have type 'native'", () => {
      expect(provider.type).toBe("native");
    });
  });

  describe("initialize", () => {
    it("should initialize sandbox with config", async () => {
      const config: SandboxConfig = {
        enabled: true,
        type: "native",
        filesystem: {
          denyRead: ["~/.ssh"],
          allowWrite: [".", "/tmp"],
          denyWrite: [".env"],
        },
        network: {
          allowedDomains: ["github.com"],
          deniedDomains: [],
        },
      };

      await provider.initialize(config);

      const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
      expect(SandboxManager.initialize).toHaveBeenCalledWith({
        filesystem: {
          denyRead: ["~/.ssh"],
          allowWrite: [".", "/tmp"],
          denyWrite: [".env"],
        },
        network: {
          allowedDomains: ["github.com"],
          deniedDomains: [],
        },
      });
    });

    it("should use default values when config is partial", async () => {
      const config: SandboxConfig = {
        enabled: true,
        type: "native",
      };

      await provider.initialize(config);

      const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
      expect(SandboxManager.initialize).toHaveBeenCalledWith({
        filesystem: {
          denyRead: [],
          allowWrite: [],
          denyWrite: [],
        },
        network: {
          allowedDomains: [],
          deniedDomains: [],
        },
      });
    });

    it("should not reinitialize if already initialized", async () => {
      const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
      (SandboxManager.isSandboxingEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);

      const config: SandboxConfig = { enabled: true, type: "native" };
      await provider.initialize(config);

      expect(SandboxManager.initialize).not.toHaveBeenCalled();

      (SandboxManager.isSandboxingEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    });
  });

  describe("isInitialized", () => {
    it("should return false when not initialized", () => {
      expect(provider.isInitialized()).toBe(false);
    });

    it("should return true when initialized", async () => {
      const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
      (SandboxManager.isSandboxingEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);

      expect(provider.isInitialized()).toBe(true);
    });
  });

  describe("wrapCommand", () => {
    it("should wrap command with sandbox", async () => {
      const wrapped = await provider.wrapCommand("curl example.com");

      expect(wrapped).toBe("sandboxed: curl example.com");
    });

    it("should handle different command types", async () => {
      const wrapped1 = await provider.wrapCommand("npm install lodash");
      const wrapped2 = await provider.wrapCommand("bash -c 'echo hello'");

      expect(wrapped1).toBe("sandboxed: npm install lodash");
      expect(wrapped2).toBe("sandboxed: bash -c 'echo hello'");
    });
  });

  describe("shouldSandbox", () => {
    it("should return false when enabled is false", () => {
      const config: SandboxConfig = { enabled: false, type: "native" };
      expect(provider.shouldSandbox("bash", config)).toBe(false);
    });

    it("should return false when config is undefined", () => {
      expect(provider.shouldSandbox("bash", undefined as any)).toBe(false);
    });

    it("should return true when enabled and no action filter", () => {
      const config: SandboxConfig = { enabled: true, type: "native" };
      expect(provider.shouldSandbox("bash", config)).toBe(true);
    });

    it("should match action filter include patterns", () => {
      const config: SandboxConfig = {
        enabled: true,
        type: "native",
        actionFilter: {
          include: ["bash", "mcp_*"],
        },
      };

      expect(provider.shouldSandbox("bash", config)).toBe(true);
      expect(provider.shouldSandbox("mcp_filesystem", config)).toBe(true);
      expect(provider.shouldSandbox("http_fetch", config)).toBe(false);
    });

    it("should exclude action filter exclude patterns", () => {
      const config: SandboxConfig = {
        enabled: true,
        type: "native",
        actionFilter: {
          include: ["bash", "mcp_*"],
          exclude: ["mcp_safe"],
        },
      };

      expect(provider.shouldSandbox("bash", config)).toBe(true);
      expect(provider.shouldSandbox("mcp_filesystem", config)).toBe(true);
      expect(provider.shouldSandbox("mcp_safe", config)).toBe(false);
    });
  });

  describe("cleanup", () => {
    it("should call reset on cleanup", async () => {
      await provider.cleanup();

      const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
      expect(SandboxManager.reset).toHaveBeenCalled();
    });
  });
});

describe("SandboxProviderFactory", () => {
  it("should create native sandbox provider", async () => {
    const { SandboxProviderFactory } = await import("./sandbox-factory.js");
    const provider = SandboxProviderFactory.create("native");
    expect(provider.type).toBe("native");
  });

  it("should throw error for docker type (not implemented)", async () => {
    const { SandboxProviderFactory } = await import("./sandbox-factory.js");
    expect(() => SandboxProviderFactory.create("docker")).toThrow("Docker sandbox is not yet implemented");
  });

  it("should throw error for unknown type", async () => {
    const { SandboxProviderFactory } = await import("./sandbox-factory.js");
    expect(() => SandboxProviderFactory.create("unknown" as any)).toThrow("Unknown sandbox type");
  });
});
