/**
 * @fileoverview 测试用 MCP 服务器 - Todo Server
 * 
 * 提供简单的 TODO 管理功能
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const todos = [];

const server = new McpServer(
  { name: "todo-mcp-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.registerTool("add_todo", {
  description: "添加一个 TODO 项",
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string", description: "TODO 内容" }
    },
    required: ["text"]
  }
}, async (args) => {
  const id = Date.now().toString();
  todos.push({ id, text: args.text, done: false });
  return { content: [{ type: "text", text: `已添加 TODO: "${args.text}" (ID: ${id})` }] };
});

server.registerTool("list_todos", {
  description: "列出所有 TODO",
  inputSchema: { type: "object", properties: {} }
}, async () => {
  if (todos.length === 0) {
    return { content: [{ type: "text", text: "暂无 TODO" }] };
  }
  const list = todos.map(t => `[${t.done ? '✓' : ' '}] ${t.id}: ${t.text}`).join('\n');
  return { content: [{ type: "text", text: `当前 TODO 列表 (${todos.length} 项):\n${list}` }] };
});

server.registerTool("complete_todo", {
  description: "标记 TODO 为已完成",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "TODO ID" }
    },
    required: ["id"]
  }
}, async (args) => {
  const todo = todos.find(t => t.id === args.id);
  if (!todo) {
    return { content: [{ type: "text", text: `未找到 ID 为 ${args.id} 的 TODO` }] };
  }
  todo.done = true;
  return { content: [{ type: "text", text: `已完成: "${todo.text}"` }] };
});

server.registerTool("delete_todo", {
  description: "删除一个 TODO",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "TODO ID" }
    },
    required: ["id"]
  }
}, async (args) => {
  const index = todos.findIndex(t => t.id === args.id);
  if (index === -1) {
    return { content: [{ type: "text", text: `未找到 ID 为 ${args.id} 的 TODO` }] };
  }
  const deleted = todos.splice(index, 1)[0];
  return { content: [{ type: "text", text: `已删除: "${deleted.text}"` }] };
});

// 启动服务器
const transport = new StdioServerTransport();
await server.connect(transport);
