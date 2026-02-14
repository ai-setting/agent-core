/**
 * @fileoverview MCP 功能测试脚本
 * 运行方式: bun run test-env/test-mcp.ts
 */

import { McpManager } from "../packages/core/src/env_spec/mcp/manager.js";
import { McpServerLoader } from "../packages/core/src/env_spec/mcp/loader.js";
import path from "path";

const testEnvDir = path.join(process.cwd(), "test-env");
const mcpserversDir = path.join(testEnvDir, "mcpservers");

async function testMcp() {
  console.log("=== MCP 功能测试 ===\n");
  
  try {
    // 测试目录扫描
    console.log("1. 测试 MCP 服务器目录扫描...");
    const loader = new McpServerLoader(mcpserversDir);
    const discovered = await loader.discover();
    console.log(`   发现 ${discovered.length} 个 MCP 服务器:`);
    for (const server of discovered) {
      console.log(`   - ${server.name}: ${server.entryPath}`);
    }
    
    // 测试 MCP 管理器
    console.log("\n2. 测试 MCP 管理器...");
    const mcpManager = new McpManager(mcpserversDir);
    
    // 测试目录扫描加载
    const result = await mcpManager.loadClients({});
    console.log(`   扫描结果: ${result.loaded} 个加载成功, ${result.failed.length} 个失败`);
    
    // 获取工具列表
    const tools = mcpManager.getTools();
    console.log(`\n3. 工具列表 (${tools.length} 个):`);
    for (const tool of tools) {
      console.log(`   - ${tool.name}`);
      console.log(`     描述: ${tool.description}`);
    }
    
    // 测试工具描述生成
    console.log("\n4. MCP 工具描述 (用于 system prompt):");
    console.log(mcpManager.getToolsDescription());
    
    console.log("\n✓ 测试完成!");
    
  } catch (error) {
    console.error("\n✗ 测试失败:", error);
  }
}

testMcp();
