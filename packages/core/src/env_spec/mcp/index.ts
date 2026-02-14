/**
 * @fileoverview MCP 模块入口
 * 
 * 提供 MCP Client 和 MCP Server 的统一管理能力：
 * - MCP Client: 连接外部 MCP 服务器，获取工具
 * - MCP Server: 将当前 Environment 暴露为 MCP 服务器
 */

export * from "./types.js"
export * from "./loader.js"
export * from "./convert.js"
export * from "./manager.js"
