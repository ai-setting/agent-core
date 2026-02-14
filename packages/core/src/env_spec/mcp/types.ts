/**
 * @fileoverview MCP 类型定义
 */

import { z } from "zod"
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

// ========== MCP Server 配置 ==========

export const McpServerConfigSchema = z.object({
  enabled: z.boolean().optional().describe("Enable MCP Server"),
  transport: z.enum(["stdio", "http"]).optional().describe("Transport type"),
  http: z.object({
    port: z.number().int().positive().optional().describe("HTTP port"),
    host: z.string().optional().describe("HTTP host"),
  }).optional(),
})

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>

// ========== MCP OAuth 配置 ==========

export const McpOAuthConfigSchema = z.object({
  clientId: z.string().optional().describe("OAuth client ID"),
  clientSecret: z.string().optional().describe("OAuth client secret"),
  scope: z.string().optional().describe("OAuth scope"),
})

export type McpOAuthConfig = z.infer<typeof McpOAuthConfigSchema>

// ========== MCP Client 配置 ==========

export const McpClientLocalSchema = z.object({
  type: z.literal("local"),
  command: z.array(z.string()).describe("Command to run the MCP server"),
  environment: z.record(z.string(), z.string()).optional().describe("Environment variables"),
  enabled: z.boolean().optional().describe("Enable this MCP server"),
  timeout: z.number().int().positive().optional().describe("Timeout in milliseconds"),
})

export const McpClientRemoteSchema = z.object({
  type: z.literal("remote"),
  url: z.string().url().describe("Remote MCP server URL"),
  enabled: z.boolean().optional().describe("Enable this MCP server"),
  headers: z.record(z.string(), z.string()).optional().describe("HTTP headers"),
  oauth: z.union([McpOAuthConfigSchema, z.literal(false)]).optional().describe("OAuth configuration"),
  timeout: z.number().int().positive().optional().describe("Timeout in milliseconds"),
})

export const McpClientConfigSchema = z.discriminatedUnion("type", [
  McpClientLocalSchema,
  McpClientRemoteSchema,
])

export type McpClientConfig = z.infer<typeof McpClientConfigSchema>

// 支持仅启用/禁用远程默认配置
export const McpClientFieldSchema = z.record(
  z.string(),
  z.union([McpClientConfigSchema, z.object({ enabled: z.boolean() })])
)

export type McpClientField = z.infer<typeof McpClientFieldSchema>

// ========== MCP 配置（主配置） ==========

export const McpConfigSchema = z.object({
  server: McpServerConfigSchema.optional().describe("MCP Server configuration"),
  clients: McpClientFieldSchema.optional().describe("MCP Clients configuration"),
})

export type McpConfig = z.infer<typeof McpConfigSchema>

// ========== MCP 状态 ==========

export interface McpClientStatus {
  name: string
  status: "connecting" | "connected" | "disconnected" | "error"
  error?: string
  toolsCount?: number
}

export interface McpServerStatus {
  enabled: boolean
  transport?: "stdio" | "http"
  url?: string
}

export interface McpStatus {
  server?: McpServerStatus
  clients: Map<string, McpClientStatus>
}

// ========== 工具转换 ==========

export interface McpToolConversionOptions {
  timeout?: number
  onError?: (error: Error) => void
  transport?: StdioClientTransport
}
