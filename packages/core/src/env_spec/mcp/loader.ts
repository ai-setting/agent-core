/**
 * @fileoverview MCP 服务器目录扫描器
 * 
 * 自动发现 mcpservers 目录下的 MCP 服务器脚本
 */

import fs from "fs/promises"
import path from "path"

export interface DiscoveredMcpServer {
  name: string
  entryPath: string
  configPath?: string
  packagePath?: string
}

export interface McpServerDirectoryConfig {
  enabled?: boolean
  timeout?: number
  environment?: Record<string, string>
}

/**
 * MCP 服务器加载器
 * 
 * 扫描 mcpservers 目录，发现所有 MCP 服务器
 * 规则：
 * 1. 每个子目录视为一个 MCP 服务器
 * 2. 目录中必须包含 server.mjs 或 server.ts 入口脚本
 * 3. 可选包含 package.json 声明依赖
 * 4. 可选包含 config.jsonc 覆盖默认配置
 */
export class McpServerLoader {
  private mcpserversDir: string

  constructor(mcpserversDir: string) {
    this.mcpserversDir = mcpserversDir
  }

  /**
   * 扫描 mcpservers 目录，发现所有 MCP 服务器
   */
  async discover(): Promise<DiscoveredMcpServer[]> {
    const servers: DiscoveredMcpServer[] = []

    try {
      const entries = await fs.readdir(this.mcpserversDir, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const serverDir = path.join(this.mcpserversDir, entry.name)

        // 查找入口脚本 (server.mjs, server.ts, index.mjs, index.ts)
        const entryPath = await this.findEntryScript(serverDir)
        if (!entryPath) continue

        const configPath = path.join(serverDir, "config.jsonc")
        const packagePath = path.join(serverDir, "package.json")

        servers.push({
          name: entry.name,
          entryPath,
          configPath: await this.fileExists(configPath) ? configPath : undefined,
          packagePath: await this.fileExists(packagePath) ? packagePath : undefined,
        })
      }
    } catch (error) {
      console.warn(`[McpServerLoader] Failed to scan directory: ${error}`)
    }

    return servers
  }

  /**
   * 查找入口脚本
   */
  private async findEntryScript(serverDir: string): Promise<string | null> {
    const candidates = [
      "server.mjs", "server.ts", "index.mjs", "index.ts", "index.js",
      "src/server.mjs", "src/server.ts", "src/index.mjs", "src/index.ts", "src/index.js"
    ]

    for (const candidate of candidates) {
      const entryPath = path.join(serverDir, candidate)
      if (await this.fileExists(entryPath)) {
        return entryPath
      }
    }

    return null
  }

  /**
   * 检查文件是否存在
   */
  private async fileExists(filepath: string): Promise<boolean> {
    try {
      await fs.access(filepath)
      return true
    } catch {
      return false
    }
  }

  /**
   * 加载服务器目录中的配置文件
   */
  async loadServerConfig(serverDir: string): Promise<McpServerDirectoryConfig | null> {
    const configPath = path.join(serverDir, "config.jsonc")

    if (!(await this.fileExists(configPath))) {
      return null
    }

    try {
      const content = await fs.readFile(configPath, "utf-8")
      // 简单的 JSONC 解析（移除注释）
      const cleaned = this.stripComments(content)
      return JSON.parse(cleaned)
    } catch (error) {
      console.warn(`[McpServerLoader] Failed to load config from ${configPath}:`, error)
      return null
    }
  }

  /**
   * 简单的注释移除
   */
  private stripComments(content: string): string {
    // 移除单行注释
    let result = content.replace(/\/\/.*$/gm, "")
    // 移除多行注释
    result = result.replace(/\/\*[\s\S]*?\*\//g, "")
    return result
  }
}
