import { describe, it, expect } from "bun:test";
import { BaseEnvironment } from "../core/environment/base/base-environment.js";
import type { Action, Context, ToolResult } from "../core/types/index.js";
import { createBaseEnvDescription, createBaseEnvProfiles } from "./base_env/index.js";

class TestEnv extends BaseEnvironment {
  constructor() {
    super({ systemPrompt: "You are a test env." });
    // 注册两个假工具
    this.registerTool({
      name: "tool_a",
      description: "A test tool",
      // @ts-expect-error 简化测试实现
      parameters: {} as any,
      async execute() {
        return { success: true, output: "ok" } as ToolResult;
      },
    } as any);
    this.registerTool({
      name: "tool_b",
      description: "Another test tool",
      // @ts-expect-error 简化测试实现
      parameters: {} as any,
      async execute() {
        return { success: true, output: "ok" } as ToolResult;
      },
    } as any);
  }

  // 为了通过 abstract 要求，这里给出简化实现即可
  protected getDefaultTimeout(): number {
    return 1000;
  }
  protected getTimeoutOverride(_action: Action): number | undefined {
    return undefined;
  }
  protected getMaxRetries(): number {
    return 0;
  }
  protected getRetryDelay(): number {
    return 0;
  }
  protected isRetryableError(): boolean {
    return false;
  }
  protected getConcurrencyLimit(): number {
    return 1;
  }
  protected getRecoveryStrategy(): {
    type: "retry" | "fallback" | "skip" | "error";
    maxRetries?: number | undefined;
    fallbackTool?: string | undefined;
  } {
    return { type: "error" };
  }
}

describe("base_env helpers", () => {
  it("createBaseEnvProfiles should derive tools and system prompt", () => {
    const env = new TestEnv();
    const profiles = createBaseEnvProfiles(env, { displayName: "Test Profile" });

    expect(profiles.length).toBe(1);
    const profile = profiles[0];
    expect(profile.id).toBe("default");
    // BaseEnvironment 实现 getProfiles() 时直接使用其返回值，displayName 为默认 "Default Profile"
    expect(profile.displayName).toBe("Default Profile");
    expect(profile.primaryAgents.length).toBe(1);

    const agent = profile.primaryAgents[0];
    expect(agent.id).toBe("default");
    expect(agent.role).toBe("primary");
    // system prompt 已在构造函数里注册，故应存在
    expect(agent.promptId).toBe("system");
    // 工具白名单应包含两个工具
    expect(agent.allowedTools?.sort()).toEqual(["tool_a", "tool_b"].sort());
  });

  it("createBaseEnvDescription should include basic metadata and profiles", () => {
    const env = new TestEnv();
    const desc = createBaseEnvDescription(env, {
      id: "test-env",
      displayName: "Test Env",
      version: "0.1.0",
    });

    expect(desc.id).toBe("test-env");
    expect(desc.displayName).toBe("Test Env");
    expect(desc.version).toBe("0.1.0");
    expect(desc.capabilities?.events).toBe(true);
    expect(desc.capabilities?.profiles).toBe(true);
    expect(desc.profiles && desc.profiles.length).toBe(1);
  });
});

