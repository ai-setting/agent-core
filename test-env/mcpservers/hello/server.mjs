/**
 * @fileoverview 测试用 MCP 服务器 - Hello Server
 * 
 * 提供简单的问候功能
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer(
  { name: "hello-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// 注册工具
server.registerTool("hello", {
  description: "向用户打招呼，返回问候信息",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "用户名" }
    },
    required: ["name"]
  }
}, async (args) => {
  return { content: [{ type: "text", text: `你好，${args.name}！欢迎使用 MCP 测试服务器！` }] };
});

server.registerTool("echo", {
  description: "回显输入的内容",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "要回显的消息" }
    },
    required: ["message"]
  }
}, async (args) => {
  return { content: [{ type: "text", text: `你说了: ${args.message}` }] };
});

server.registerTool("add", {
  description: "计算两个数的和",
  inputSchema: {
    type: "object",
    properties: {
      a: { type: "number", description: "第一个数" },
      b: { type: "number", description: "第二个数" }
    },
    required: ["a", "b"]
  }
}, async (args) => {
  const result = args.a + args.b;
  return { content: [{ type: "text", text: `${args.a} + ${args.b} = ${result}` }] };
});

// 启动服务器
const transport = new StdioServerTransport();
await server.connect(transport);
