# Agent Core Web Search & Fetch 机制设计文档

> 本文档描述 agent-core 中 Web Search、Web Fetch 工具机制的设计方案，参考 thirdparty 实现（oh-my-opencode、openclaw、opencode）并遵循 agent-core 的 Environment 设计理念。

> **重要更新（2026-02-19）**：根据用户反馈，修正设计思路：
> - Web Search 直接通过 MCP 配置接入，不在原生工具内部调用 MCP
> - Web Fetch 为原生工具（使用 Readability + fetch）
> - **ask 权限机制为未来待实现功能**，不在本次设计范围内

---

## 一，设计背景与目标

### 1.1 需求来源

根据 `docs/environment-design-philosophy.md` 的设计理念，Environment 是 Agent 的运行时上下文，负责：
- 工具的注册、列举，执行入口与生命周期管理
- 一切 I/O 与外部交互的落地（网络、文件等）

Web Search 和 Web Fetch 是 Agent 获取外部信息的重要工具。

### 1.2 设计目标

1. **MCP 优先**：遵循 agent-core 的 MCP 优先原则，Web Search 通过 MCP 配置直接接入
2. **开箱即用**：优先使用开源或免费的 Provider
3. **内容提取**：集成 Readability 进行页面内容净化

---

## 二、架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        BaseEnvironment                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Web Tools Module                           │   │
│  │                                                         │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │  MCP 配置（Web Search）                          │   │   │
│  │  │  mcp.exa = { url, headers, enabled }           │   │   │
│  │  │         ↓ MCP Client 连接                        │   │   │
│  │  │  工具注册：web_search_exa (来自 Exa MCP)         │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │  原生工具（Web Fetch）                           │   │   │
│  │  │  createWebFetchTool() → tool: webfetch         │   │   │
│  │  │  (使用 Readability + fetch)                     │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 设计要点

| 功能 | 实现方式 | 说明 |
|------|----------|------|
| **Web Search** | MCP 配置 | 通过 MCP Client 连接到 Exa，直接注册工具 |
| **Web Fetch** | 原生工具 | 使用 Readability + fetch |
| **权限控制** | ask 机制 | 待新增功能 |

---

## 三、Web Search 设计

### 3.1 正确的实现方式

**不是**在原生工具内部调用 MCP，而是直接通过 MCP 配置把 Exa 注册为工具：

```jsonc
// 配置：~/.config/tong_work/agent-core/environments/os_env/config.jsonc
{
  "mcp": {
    "exa": {
      "type": "remote",
      "url": "https://mcp.exa.ai/mcp?tools=web_search_exa",
      "enabled": true
      // 无需 API Key，Exa 可选
    }
  }
}
```

**效果**：Exa MCP 服务器的工具 `web_search_exa` 会直接注册为 Agent 的原生工具。

### 3.2 多 Provider 配置

如果需要切换 Provider：

```jsonc
{
  "mcp": {
    "tavily": {
      "type": "remote", 
      "url": "https://mcp.tavily.com/mcp/",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer ${env:TAVILY_API_KEY}"
      }
    }
  }
}
```

### 3.3 Exa MCP 工具参数

Exa MCP 提供 `web_search_exa` 工具，参数：

| 参数 | 类型 | 说明 |
|------|------|------|
| query | string | 搜索查询 |
| numResults | number | 返回结果数 (默认 8) |
| type | string | 搜索类型: auto/fast/deep |
| livecrawl | string | 实时爬取: fallback/preferred |

---

## 四、Web Fetch 设计

### 4.1 原生工具实现

Web Fetch 是一个原生工具，不是 MCP：

```typescript
// packages/core/src/tools/web/web-fetch.ts

import { z } from "zod"
import { extractReadableContent, htmlToMarkdown } from "./readability.js"

/**
 * Web Fetch 原生工具
 * 使用 Readability 提取页面主要内容
 */
export function createWebFetchTool(): ToolInfo {
  return {
    name: "webfetch",
    description: "Fetch and extract readable content from a URL. Uses Readability to extract main content, filtering out ads and navigation.",
    parameters: z.object({
      url: z.string().describe("The URL to fetch content from"),
      format: z.enum(["markdown", "text", "html"]).default("markdown"),
      maxChars: z.number().optional(),
    }),
    
    async execute(args, context): Promise<ToolResult> {
      const { url, format, maxChars } = args
      
      // 参数校验
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return { success: false, output: "", error: "URL must start with http:// or https://" }
      }
      
      // 获取内容
      const response = await fetch(url, {
        headers: { "User-Agent": DEFAULT_USER_AGENT }
      })
      
      const text = await response.text()
      
      // Readability 提取
      let extracted = text
      if (format !== "html" && isHtml(text)) {
        const readable = await extractReadableContent(text, url)
        extracted = format === "text" ? readable.text : readable.text
        
        if (format === "markdown") {
          extracted = readable.text
        }
      }
      
      // 截断
      const effectiveMax = maxChars ?? DEFAULT_MAX_CHARS
      const { truncated, text: final } = truncateText(extracted, effectiveMax)
      
      return {
        success: true,
        output: formatOutput(final, truncated),
      }
    },
  }
}
```

### 4.2 Readability 集成

```typescript
// packages/core/src/tools/web/readability.ts

import { Readability } from "@mozilla/readability"
import { JSDOM } from "jsdom"

export async function extractReadableContent(html: string, url: string): Promise<{
  title?: string
  text: string
}> {
  try {
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    
    return {
      title: article?.title,
      text: article?.textContent || stripHtml(html),
    }
  } catch {
    return { text: stripHtml(html) }
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>.*?<\/script>/gi, "")
    .replace(/<style[^>]*>.*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
}
```

### 4.3 配置

```jsonc
{
  "tools": {
    "webfetch": {
      "enabled": true,
      "maxChars": 50000,
      "timeout": 30000
    }
  }
}
```

---

## 五、实施计划

### Phase 1: MCP 配置支持
- [ ] 确认 agent-core MCP Client 已支持 Remote MCP
- [ ] 配置 Exa MCP 连接方式
- [ ] 测试工具注册

### Phase 2: Web Fetch 原生工具
- [ ] 实现 Web Fetch 工具
- [ ] 集成 Readability
- [ ] 配置 Schema

### Phase 3: Environment 集成
- [ ] 在 BaseEnvironment 中注册 Web Fetch
- [ ] 工具列表支持

### Phase 4: 权限机制（未来待实现）
- [ ] ask 机制设计
- [ ] 权限配置 Schema
- [ ] 执行入口集成

---

## 七、关键代码路径

| 功能 | 文件 |
|------|------|
| Web Fetch 工具 | `packages/core/src/tools/web/web-fetch.ts` |
| Readability | `packages/core/src/tools/web/readability.ts` |
| MCP 配置 | `packages/core/src/config/schema/` |
| BaseEnvironment | `packages/core/src/core/environment/base/base-environment.ts` |

---

## 八、决策记录

- 2026-02-19：创建设计文档
- 2026-02-19：修正设计 - Web Search 通过 MCP 直接注册，不是"转一道"
- 2026-02-19：明确 Web Fetch 为原生工具
- 2026-02-19：ask 权限机制为未来待实现功能，本次设计不包含
