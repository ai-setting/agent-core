#!/usr/bin/env bun
/**
 * @fileoverview BaseEnvironment + Env Spec 集成示例
 * 
 * 演示如何将真实的 BaseEnvironment 通过 Env MCP Server 暴露出去
 * 重点展示 base_env 如何自动从 BaseEnvironment 推导配置
 * 
 * 用法:
 *   bun run examples/env-with-base-env.ts
 */

import { BaseEnvironment } from "../packages/core/src/core/environment/base/base-environment.js";
import type { Action, Context, ToolResult } from "../packages/core/src/core/types/index.js";
import { createEnvMcpServer } from "../packages/core/src/env_spec/server.js";
import type { EnvMcpServerLike } from "../packages/core/src/env_spec/server.js";
import type { EnvDescription, EnvProfile, AgentSpec } from "../packages/core/src/env_spec/types.js";
import { createBaseEnvDescription, createBaseEnvProfiles } from "../packages/core/src/env_spec/base_env/index.js";

/**
 * 创建一个真实的 BaseEnvironment 实例
 * 包含工具、prompts 等配置
 */
class MyProductionEnv extends BaseEnvironment {
  constructor() {
    super({ 
      systemPrompt: `You are a helpful coding assistant.
You can read files, execute bash commands, and write files.
Always follow security best practices.`
    });

    // 注册工具（这些会被自动暴露到 env protocol）
    this.registerTool({
      name: "file_read",
      description: "Read file contents",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" }
        },
        required: ["path"]
      },
      async execute(params: { path: string }, context: Context): Promise<ToolResult> {
        // 简化实现，实际会读取真实文件
        return {
          success: true,
          output: `Contents of ${params.path}:\n// This is a mock file content`,
        };
      },
    } as any);

    this.registerTool({
      name: "file_write",
      description: "Write content to file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          content: { type: "string", description: "Content to write" }
        },
        required: ["path", "content"]
      },
      async execute(params: { path: string; content: string }, context: Context): Promise<ToolResult> {
        return {
          success: true,
          output: `Successfully wrote to ${params.path}`,
        };
      },
    } as any);

    this.registerTool({
      name: "bash",
      description: "Execute bash commands",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to execute" },
          timeout: { type: "number", description: "Timeout in ms", default: 30000 }
        },
        required: ["command"]
      },
      async execute(params: { command: string; timeout?: number }, context: Context): Promise<ToolResult> {
        return {
          success: true,
          output: `$ ${params.command}\n// Command executed successfully`,
        };
      },
    } as any);

    // 注册额外的 prompt
    this.addPrompt({ id: "reviewer", content: "You are a code reviewer. Focus on security and best practices." });
    this.addPrompt({ id: "architect", content: "You are a system architect. Design scalable solutions." });
  }

  // 实现抽象方法（配置策略）
  protected getDefaultTimeout(): number { return 30000; }
  protected getTimeoutOverride(_action: Action): number | undefined { return undefined; }
  protected getMaxRetries(): number { return 3; }
  protected getRetryDelay(): number { return 1000; }
  protected isRetryableError(_error: string): boolean { return true; }
  protected getConcurrencyLimit(): number { return 5; }
  protected getRecoveryStrategy(): { type: "retry" | "fallback" | "skip" | "error"; maxRetries?: number; fallbackTool?: string } {
    return { type: "retry", maxRetries: 3 };
  }
}

/**
 * 简单的内存 Server 实现（用于演示）
 */
class SimpleServer implements EnvMcpServerLike {
  public tools = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
  
  tool(name: string, handler: (params: unknown) => Promise<unknown> | unknown): void {
    this.tools.set(name, handler);
    console.log(`  ✓ Registered tool: ${name}`);
  }

  async call(method: string, params: unknown): Promise<unknown> {
    const handler = this.tools.get(method);
    if (!handler) throw new Error(`Tool not found: ${method}`);
    return await handler(params);
  }
}

/**
 * 主函数：演示 base_env 如何自动从 BaseEnvironment 推导配置
 */
async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("BaseEnvironment + Env Spec Integration Demo");
  console.log("=".repeat(60) + "\n");

  // 步骤 1: 创建真实的 BaseEnvironment
  console.log("Step 1: Creating MyProductionEnv...");
  const env = new MyProductionEnv();
  console.log("  ✓ Environment created");
  console.log(`  ✓ Registered tools: ${["file_read", "file_write", "bash"].join(", ")}`);
  console.log(`  ✓ Registered prompts: system, reviewer, architect\n`);

  // 步骤 2: 使用 createEnvMcpServer + base_env 自动推导配置
  // 这就是 base_env 发挥作用的地方！
  console.log("Step 2: Creating Env MCP Server with auto-derived config...");
  console.log("  (base_env will automatically extract tools and prompts)\n");
  
  const server = new SimpleServer();
  
  // 从 BaseEnvironment 自动推导配置
  const description = createBaseEnvDescription(env, {
    id: "my-production-env",
    displayName: "My Production Environment",
    version: "1.0.0",
  });
  
  const profiles = createBaseEnvProfiles(env, {
    displayName: "My Production Environment",
  });
  
  // 创建 server，使用自动推导的配置
  createEnvMcpServer(server, env, {
    describeEnv: () => description,
    listProfiles: () => profiles,
    listAgents: (params) => {
      // 从 profiles 中提取所有 agents
      let agents = profiles.flatMap(p => p.primaryAgents);
      if (params?.role) {
        agents = agents.filter(a => a.role === params.role);
      }
      return agents;
    },
    getAgent: (id) => {
      const agent = profiles.flatMap(p => p.primaryAgents).find(a => a.id === id);
      if (!agent) throw new Error(`Agent not found: ${id}`);
      return agent;
    },
  });

  console.log("\nStep 3: Testing Env Protocol methods...\n");

  // 步骤 3: 测试各个方法
  console.log("3.1 Get Environment Description");
  console.log("-".repeat(40));
  const desc = await server.call("env/get_description", {}) as EnvDescription;
  console.log(`ID: ${desc.id}`);
  console.log(`Name: ${desc.displayName}`);
  console.log(`Version: ${desc.version}`);
  console.log(`Capabilities:`, desc.capabilities);
  console.log(`Profiles count: ${desc.profiles?.length}\n`);

  console.log("3.2 List Profiles");
  console.log("-".repeat(40));
  const profilesResult = await server.call("env/list_profiles", {}) as { profiles: EnvProfile[] };
  for (const profile of profilesResult.profiles) {
    console.log(`\nProfile: ${profile.id}`);
    console.log(`  Display Name: ${profile.displayName}`);
    console.log(`  Agents: ${profile.primaryAgents.length}`);
    
    for (const agent of profile.primaryAgents) {
      console.log(`\n  Agent: ${agent.id}`);
      console.log(`    Role: ${agent.role}`);
      console.log(`    Prompt ID: ${agent.promptId}`);
      console.log(`    Allowed Tools: ${agent.allowedTools?.join(", ")}`);
    }
  }

  console.log("\n\n3.3 Get Profile");
  console.log("-".repeat(40));
  const profile = await server.call("env/get_profile", { id: "default" }) as EnvProfile;
  console.log(`Retrieved profile: ${profile.displayName}`);
  console.log(`Has ${profile.primaryAgents.length} agents\n`);

  console.log("3.4 List Agents");
  console.log("-".repeat(40));
  const agentsResult = await server.call("env/list_agents", {}) as { agents: AgentSpec[] };
  console.log(`Total agents: ${agentsResult.agents.length}`);
  for (const agent of agentsResult.agents) {
    console.log(`  - ${agent.id} (${agent.role}): ${agent.allowedTools?.length} tools`);
  }

  console.log("\n\n" + "=".repeat(60));
  console.log("Demo completed successfully!");
  console.log("=".repeat(60));
  console.log("\nKey takeaways:");
  console.log("1. BaseEnvironment 自动管理工具和 prompts");
  console.log("2. createBaseEnvMcpServer 自动推导 EnvDescription");
  console.log("3. 工具白名单从 env.listTools() 自动获取");
  console.log("4. Prompt ID 优先使用 'system' prompt");
  console.log("5. 无需手动编写 env 配置，一切自动推导！\n");
}

main().catch(console.error);
