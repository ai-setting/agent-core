/**
 * @fileoverview MCP 工具到 Environment Tool 的转换器
 */

import { z } from "zod"
import type { Tool as McpTool, CallToolResult as McpCallToolResult } from "@modelcontextprotocol/sdk/types.js"
import type { Client as McpClient } from "@modelcontextprotocol/sdk/client/index.js"
import type { ToolInfo, ToolResult, ToolContext } from "../../core/types/index.js"
import type { McpToolConversionOptions } from "./types.js"

interface JSONSchema7 {
  type?: string
  properties?: Record<string, JSONSchema7>
  required?: string[]
  items?: JSONSchema7
  additionalProperties?: boolean | JSONSchema7
  description?: string
  [key: string]: unknown
}

/**
 * 将 MCP 工具转换为 Environment 的 ToolInfo 格式
 * 
 * 转换要点：
 * 1. 工具命名：{mcpName}_{toolName}，避免与其他工具冲突
 * 2. 参数 schema：从 MCP inputSchema 转换为 Zod
 * 3. 执行逻辑：调用 MCP client 的 callTool
 */
export function convertMcpTool(
  mcpTool: McpTool,
  mcpClient: McpClient,
  mcpName: string,
  options?: McpToolConversionOptions
): ToolInfo {
  const toolName = `${mcpName}_${mcpTool.name}`

  // 将 MCP inputSchema 转换为 Zod schema
  const zodParams = convertInputSchemaToZod(mcpTool.inputSchema)

  return {
    name: toolName,
    description: mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
    parameters: zodParams,
    execute: async (args: unknown, _context: ToolContext): Promise<ToolResult> => {
      try {
        // 调用 MCP 工具
        const result = await (mcpClient as any).request(
          { method: "tools/call", params: { name: mcpTool.name, arguments: (args as Record<string, unknown>) ?? {} } },
          (mcpTool as any).resultSchema
        )

        // 转换结果格式
        return convertMcpCallResult(result)
      } catch (error) {
        options?.onError?.(error as Error)
        return {
          success: false,
          output: "",
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

/**
 * 将 MCP inputSchema 转换为 Zod schema
 */
function convertInputSchemaToZod(inputSchema: McpTool["inputSchema"]): z.ZodType<unknown> {
  if (!inputSchema) {
    return z.unknown()
  }

  // 处理 JSON Schema 格式
  const schema = inputSchema as JSONSchema7

  const properties = schema.properties ?? {}
  const required = schema.required ?? []

  const zodFields: Record<string, z.ZodType> = {}

  for (const [key, prop] of Object.entries(properties)) {
    const isRequired = required.includes(key)
    const zodType = jsonSchemaPropToZod(prop as JSONSchema7)
    zodFields[key] = isRequired ? zodType : zodType.optional()
  }

  if (Object.keys(zodFields).length === 0) {
    return z.unknown()
  }

  return z.object(zodFields).strict()
}

/**
 * 将 JSON Schema 属性转换为 Zod 类型
 */
function jsonSchemaPropToZod(prop: JSONSchema7): z.ZodType {
  const type = prop.type as string

  switch (type) {
    case "string":
      return z.string()
    case "number":
    case "integer":
      return z.number()
    case "boolean":
      return z.boolean()
    case "array":
      if (prop.items) {
        return z.array(jsonSchemaPropToZod(prop.items as JSONSchema7))
      }
      return z.array(z.unknown())
    case "object":
      if (prop.properties) {
        const fields: Record<string, z.ZodType> = {}
        for (const [key, value] of Object.entries(prop.properties)) {
          fields[key] = jsonSchemaPropToZod(value as JSONSchema7)
        }
        return z.object(fields)
      }
      return z.record(z.string(), z.unknown())
    default:
      // 处理 enum
      if (prop.enum) {
        return z.enum(prop.enum as [string, ...string[]])
      }
      return z.unknown()
  }
}

/**
 * 转换 MCP 调用结果为 ToolResult
 */
function convertMcpCallResult(result: McpCallToolResult): ToolResult {
  // MCP 结果格式: { content: Array<{ type: "text", text: string }>, isError?: boolean }
  const content = result.content
  const textContent = content
    .filter(c => c.type === "text")
    .map(c => c.text)
    .join("")

  return {
    success: !result.isError,
    output: textContent,
    error: result.isError ? textContent : undefined,
  }
}

/**
 * 创建带有工具描述的 MCP 工具列表
 */
export function createMcpToolsDescription(tools: ToolInfo[]): string {
  if (tools.length === 0) {
    return "  No MCP tools currently available."
  }

  return tools
    .map(t => `  - ${t.name}: ${t.description}`)
    .join("\n")
}
