# oh-my-opencode 功能机制分析文档

## 概述

本文档分析 `oh-my-opencode` 项目中与以下功能相关的实现机制：
1. Web Search / Web Fetch 机制
2. Deep Research 相关功能
3. Computer Use / 浏览器自动化功能

---

## 一、Web Search 机制

### 1.1 架构设计

oh-my-opencode 采用 **Remote MCP (Model Context Protocol)** 架构实现 Web Search 功能，支持多种 Provider。

**核心文件：**
- `src/mcp/websearch.ts` - Web Search MCP 配置
- `src/mcp/index.ts` - MCP 工厂函数
- `src/config/schema.ts` - 配置 Schema 定义
- `src/mcp/types.ts` - MCP 类型定义

### 1.2 Provider 支持

| Provider | URL | 认证方式 | API Key 要求 |
|----------|-----|----------|-------------|
| **exa** (默认) | `mcp.exa.ai/mcp?tools=web_search_exa` | `x-api-key` header | 可选 |
| **tavily** | `mcp.tavily.com/mcp/` | `Authorization: Bearer` | 必需 |

### 1.3 核心实现代码

**文件：`src/mcp/websearch.ts`**
```typescript
import type { WebsearchConfig } from "../config/schema"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

export function createWebsearchConfig(config?: WebsearchConfig): RemoteMcpConfig {
  const provider = config?.provider || "exa"

  if (provider === "tavily") {
    const tavilyKey = process.env.TAVILY_API_KEY
    if (!tavilyKey) {
      throw new Error("TAVILY_API_KEY environment variable is required for Tavily provider")
    }
    return {
      type: "remote" as const,
      url: "https://mcp.tavily.com/mcp/",
      enabled: true,
      headers: { Authorization: `Bearer ${tavilyKey}` },
      oauth: false as const,
    }
  }

  // Default to Exa
  return {
    type: "remote" as const,
    url: "https://mcp.exa.ai/mcp?tools=web_search_exa",
    enabled: true,
    headers: process.env.EXA_API_KEY
      ? { "x-api-key": process.env.EXA_API_KEY }
      : undefined,
    oauth: false as const,
  }
}
```

**配置 Schema (`src/config/schema.ts:343-352`)**
```typescript
export const WebsearchProviderSchema = z.enum(["exa", "tavily"])

export const WebsearchConfigSchema = z.object({
  provider: WebsearchProviderSchema.optional(),
})

// 使用方式
// {
//   "websearch": {
//     "provider": "tavily"  // 或 "exa" (默认)
//   }
// }
```

### 1.4 MCP 注册与加载

**文件：`src/mcp/index.ts`**
```typescript
export function createBuiltinMcps(disabledMcps: string[] = [], config?: OhMyOpenCodeConfig) {
  const mcps: Record<string, RemoteMcpConfig> = {}

  if (!disabledMcps.includes("websearch")) {
    mcps.websearch = createWebsearchConfig(config?.websearch)
  }

  // ... 其他 MCP
  return mcps
}
```

---

## 二、Web Fetch 机制

### 2.1 设计思路

Web Fetch **不是内部实现的工具**，而是通过 MCP 外部工具调用实现的。但关键问题是：**如何处理长网页导致的上下文窗口占用？**

### 2.2 核心解决方案：智能截断

oh-my-opencode 实现了 **动态 Token 截断机制**，在内容进入 LLM 之前进行预处理。

**文件：`src/hooks/tool-output-truncator.ts`**

```typescript
const DEFAULT_MAX_TOKENS = 50_000 // ~200k chars
const WEBFETCH_MAX_TOKENS = 10_000 // ~40k chars - web pages need aggressive truncation

const TRUNCATABLE_TOOLS = [
  "grep",
  "webfetch",
  "WebFetch",
  // ...其他工具
]

const TOOL_SPECIFIC_MAX_TOKENS: Record<string, number> = {
  webfetch: WEBFETCH_MAX_TOKENS,
  WebFetch: WEBFETCH_MAX_TOKENS,
}

export function createToolOutputTruncatorHook(ctx: PluginInput, options?: ToolOutputTruncatorOptions) {
  const truncator = createDynamicTruncator(ctx)
  
  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    // 只有在 TRUNCATABLE_TOOLS 列表中的工具才会被截断
    if (!TRUNCATABLE_TOOLS.includes(input.tool)) return
    
    const targetMaxTokens = TOOL_SPECIFIC_MAX_TOKENS[input.tool] ?? DEFAULT_MAX_TOKENS
    const { result, truncated } = await truncator.truncate(
      input.sessionID,
      output.output,
      { targetMaxTokens }
    )
    
    if (truncated) {
      output.output = result  // 替换为截断后的内容
    }
  }
  
  return {
    "tool.execute.after": toolExecuteAfter,
  }
}
```

### 2.3 截断算法：保留头部 + 智能裁剪

**文件：`src/shared/dynamic-truncator.ts`**

```typescript
const CHARS_PER_TOKEN_ESTIMATE = 4;  // 估算：4 字符 = 1 token

// 核心截断函数
export function truncateToTokenLimit(
  output: string,
  maxTokens: number,
  preserveHeaderLines = 3,  // 默认保留前 3 行作为标识
): TruncationResult {
  const currentTokens = Math.ceil(output.length / CHARS_PER_TOKEN_ESTIMATE);
  
  // 如果内容本身小于限制，直接返回
  if (currentTokens <= maxTokens) {
    return { result: output, truncated: false };
  }
  
  const lines = output.split("\n");
  
  // 1. 保留头部（通常包含标题、URL 等关键信息）
  const headerLines = lines.slice(0, preserveHeaderLines);
  const contentLines = lines.slice(preserveHeaderLines);
  
  const headerText = headerLines.join("\n");
  const headerTokens = Math.ceil(headerText.length / CHARS_PER_TOKEN_ESTIMATE);
  const truncationMessageTokens = 50;  // 截断提示语占用的 token
  
  const availableTokens = maxTokens - headerTokens - truncationMessageTokens;
  
  // 2. 逐行添加内容，直到达到限制
  const resultLines: string[] = [];
  let currentTokenCount = 0;
  
  for (const line of contentLines) {
    const lineTokens = Math.ceil((line + "\n").length / CHARS_PER_TOKEN_ESTIMATE);
    if (currentTokenCount + lineTokens > availableTokens) {
      break;  // 达到限制，停止添加
    }
    resultLines.push(line);
    currentTokenCount += lineTokens;
  }
  
  // 3. 添加截断提示
  const removedCount = contentLines.length - resultLines.length;
  return {
    result: [
      ...headerLines,
      ...resultLines,
      "",  // 空行
      `[${removedCount} more lines truncated due to context window limit]`
    ].join("\n"),
    truncated: true,
    removedCount,
  };
}
```

### 2.4 动态上下文感知截断

除了固定的 10k token 限制，系统还能**根据当前上下文窗口使用情况动态调整**：

```typescript
export async function dynamicTruncate(
  ctx: PluginInput,
  sessionID: string,
  output: string,
  options: TruncationOptions = {},
): Promise<TruncationResult> {
  const { targetMaxTokens = DEFAULT_TARGET_MAX_TOKENS } = options;
  
  // 获取当前会话的上下文使用情况
  const usage = await getContextWindowUsage(ctx, sessionID);
  
  if (!usage) {
    // 无法获取使用情况时，回退到保守截断
    return truncateToTokenLimit(output, targetMaxTokens, preserveHeaderLines);
  }
  
  // 动态计算：取 剩余空间的50% 和 工具指定限制 的最小值
  const maxOutputTokens = Math.min(
    usage.remainingTokens * 0.5,  // 保留 50% 空间给后续内容
    targetMaxTokens,
  );
  
  return truncateToTokenLimit(output, maxOutputTokens, preserveHeaderLines);
}
```

### 2.5 截断效果示例

**原始网页内容**（假设 50k tokens）：
```
<!DOCTYPE html>
<html>
<head><title>React 文档</title></head>
<body>
<h1>Getting Started</h1>
<p>React 是一个用于构建用户界面的 JavaScript 库...</p>
... (5000 行内容) ...
</body>
</html>
```

**截断后输出**：
```html
<!DOCTYPE html>
<html>
<head><title>React 文档</title></head>
<body>
<h1>Getting Started</h1>
<p>React 是一个用于构建用户界面的 JavaScript 库...</p>
... (部分内容) ...

[2457 more lines truncated due to context window limit]
```

### 2.6 权限控制

**文件：`src/config/schema.ts`**
```typescript
// 在工具权限配置中使用
webfetch: PermissionValue.optional(),  // "ask" / "allow" / "deny"
```

**文件：`src/plugin-handlers/config-handler.ts:443`**
```typescript
webfetch: "allow",  // 默认允许
```

---

## 三、Deep Research 机制

### 3.1 核心 Agent: Librarian

Deep Research 功能主要通过 **Librarian Agent** 实现，这是一个专门用于外部代码库和文档研究的子 Agent。

**文件：`src/agents/librarian.ts`**

### 3.2 研究流程设计

Librarian Agent 采用 **四阶段研究模型**：

```
Phase 0: 请求分类 → Phase 0.5: 文档发现 → Phase 1: 按类型执行 → Phase 2: 证据综合
```

**Phase 0: 请求分类**
| 类型 | 触发条件 | 工具链 |
|------|----------|--------|
| TYPE A: 概念性 | "How do I use X?" | Doc Discovery → context7 + websearch |
| TYPE B: 实现性 | "How does X implement Y?" | gh clone + read + blame |
| TYPE C: 上下文 | "Why was this changed?" | gh issues/prs + git log/blame |
| TYPE D: 综合研究 | 复杂/模糊请求 | Doc Discovery → 所有工具 |

**Phase 0.5: 文档发现流程**
```typescript
// 1. 搜索官方文档 URL
websearch("library-name official documentation site")

// 2. 版本检查
webfetch(official_docs_url + "/versions")

// 3. Sitemap 发现
webfetch(official_docs_base_url + "/sitemap.xml")

// 4. 针对性抓取
webfetch(specific_doc_page_from_sitemap)
context7_query-docs(libraryId: id, query: "specific topic")
```

### 3.3 工具调用规范

Librarian Agent 可用的工具：
| 工具 | 用途 | 命令/使用 |
|------|------|-----------|
| context7 | 官方文档 | `context7_resolve-library-id` → `context7_query-docs` |
| websearch_exa | 查找文档URL | `websearch_exa_web_search_exa("query")` |
| webfetch | Sitemap/文档页 | `webfetch(url)` |
| grep_app | GitHub代码搜索 | `grep_app_searchGitHub(query, language)` |
| gh CLI | 克隆/克隆/历史 | `gh repo clone`, `gh search issues` |

### 3.4 并行执行策略

```typescript
// TYPE D 综合研究 - 至少 6 个并行调用
Tool 1: context7_resolve-library-id → context7_query-docs
Tool 2: webfetch(targeted_doc_pages_from_sitemap)
Tool 3: grep_app_searchGitHub(query: "pattern1", language: [...])
Tool 4: grep_app_searchGitHub(query: "pattern2", useRegexp: true)
Tool 5: gh repo clone owner/repo ${TMPDIR:-/tmp}/repo -- --depth 1
Tool 6: gh search issues "topic" --repo owner/repo
```

---

## 四、Computer Use / 浏览器自动化

### 4.1 支持的 Provider

oh-my-opencode 支持多种浏览器自动化 Provider：

| Provider | 描述 | 依赖 |
|----------|------|------|
| **playwright** (默认) | Playwright MCP Server | `@playwright/mcp` |
| **agent-browser** | Vercel agent-browser CLI | `agent-browser` |
| **dev-browser** | 持久化浏览器状态 | `dev-browser` |

### 4.2 配置定义

**文件：`src/config/schema.ts:331-341`**
```typescript
export const BrowserAutomationProviderSchema = z.enum(["playwright", "agent-browser", "dev-browser"])

export const BrowserAutomationConfigSchema = z.object({
  provider: BrowserAutomationProviderSchema.default("playwright"),
})

// 配置示例
{
  "browser_automation_engine": {
    "provider": "agent-browser"  // 或 "playwright", "dev-browser"
  }
}
```

### 4.3 Skill 定义

**文件：`src/features/builtin-skills/skills/playwright.ts`**

**Playwright Skill：**
```typescript
export const playwrightSkill: BuiltinSkill = {
  name: "playwright",
  description: "MUST USE for any browser-related tasks. Browser automation via Playwright MCP...",
  template: `# Playwright Browser Automation\n\nThis skill provides browser automation capabilities...`,
  mcpConfig: {
    playwright: {
      command: "npx",
      args: ["@playwright/mcp@latest"],
    },
  },
}
```

**Agent-Browser Skill (更强大的 CLI 工具)：**
```typescript
export const agentBrowserSkill: BuiltinSkill = {
  name: "agent-browser",
  description: "MUST USE for any browser-related tasks. Browser automation via agent-browser CLI...",
  template: `# Browser Automation with agent-browser`,
  allowedTools: ["Bash(agent-browser:*)"],
}
```

### 4.4 agent-browser 核心命令

**文件：`src/features/builtin-skills/skills/playwright.ts:17-310`**

| 类别 | 命令示例 | 描述 |
|------|----------|------|
| **导航** | `agent-browser open <url>` | 打开 URL |
| | `agent-browser back/forward` | 前进/后退 |
| | `agent-browser close` | 关闭浏览器 |
| **快照** | `agent-browser snapshot -i` | 获取交互元素 |
| | `agent-browser snapshot -c` | 紧凑输出 |
| | `agent-browser snapshot -s "#main"` | 限定范围 |
| **交互** | `agent-browser click @e1` | 点击元素 |
| | `agent-browser fill @e2 "text"` | 填写输入框 |
| | `agent-browser type @e2 "text"` | 输入文本 |
| | `agent-browser hover @e1` | 悬停 |
| | `agent-browser select @e1 "value"` | 下拉选择 |
| **获取信息** | `agent-browser get text @e1` | 获取文本 |
| | `agent-browser get html @e1` | 获取 HTML |
| | `agent-browser get title` | 获取标题 |
| | `agent-browser get url` | 获取当前 URL |
| **状态检查** | `agent-browser is visible @e1` | 检查可见性 |
| | `agent-browser is enabled @e1` | 检查可用性 |
| **截图/PDF** | `agent-browser screenshot` | 截图 |
| | `agent-browser screenshot --full` | 全页截图 |
| | `agent-browser pdf output.pdf` | 生成 PDF |
| **录制** | `agent-browser record start ./demo.webm` | 开始录制 |
| | `agent-browser record stop` | 停止录制 |
| **等待** | `agent-browser wait @e1` | 等待元素 |
| | `agent-browser wait 2000` | 等待毫秒 |
| | `agent-browser wait --text "Success"` | 等待文本 |
| **网络** | `agent-browser network route <url> --abort` | 拦截请求 |
| | `agent-browser network requests` | 查看请求 |
| **会话/配置** | `agent-browser --session <name>` | 隔离会话 |
| | `agent-browser --profile <path>` | 持久化配置 |
| | `agent-browser set headers '{"X-Key":"v"}'` | 设置请求头 |

### 4.5 完整使用示例

**表单提交流程：**
```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# 输出: textbox "Email" [ref=e1], textbox "Password" [ref=e2], button "Submit" [ref=e3]

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # 检查结果
```

**认证状态持久化：**
```bash
# 登录并保存状态
agent-browser open https://app.example.com/login
agent-browser fill @e1 "username"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser state save auth.json

# 后续会话加载状态
agent-browser state load auth.json
agent-browser open https://app.example.com/dashboard
```

### 4.6 Provider 切换逻辑

**文件：`src/features/builtin-skills/skills.ts`**
```typescript
export function createBuiltinSkills(options: CreateBuiltinSkillsOptions = {}): BuiltinSkill[] {
  const { browserProvider = "playwright", disabledSkills } = options

  // 根据配置选择浏览器 skill
  const browserSkill = browserProvider === "agent-browser" 
    ? agentBrowserSkill 
    : playwrightSkill

  const skills = [browserSkill, frontendUiUxSkill, gitMasterSkill, devBrowserSkill]
  return skills.filter((skill) => !disabledSkills?.has(skill.name))
}
```

---

## 五、其他内置 MCP

### 5.1 Context7 (文档查询)

**文件：`src/mcp/context7.ts`**
```typescript
export const context7 = {
  type: "remote" as const,
  url: "https://mcp.context7.com/mcp",
  enabled: true,
  headers: process.env.CONTEXT7_API_KEY
    ? { Authorization: `Bearer ${process.env.CONTEXT7_API_KEY}` }
    : undefined,
  oauth: false as const,
}
```

**用途：** 获取官方文档，使用方式：
```
context7_resolve-library-id("library-name")
→ context7_query-docs(libraryId: id, query: "specific-topic")
```

### 5.2 grep_app (GitHub 代码搜索)

**文件：`src/mcp/grep-app.ts`**
```typescript
export const grep_app = {
  type: "remote" as const,
  url: "https://mcp.grep.app",
  enabled: true,
  oauth: false as const,
}
```

**用途：** GitHub 代码搜索，使用方式：
```
grep_app_searchGitHub(query: "pattern", language: ["TypeScript"], useRegexp: true)
```

---

## 六、文件路径汇总

| 功能 | 核心文件 | 描述 |
|------|----------|------|
| **Web Search** | `src/mcp/websearch.ts` | Exa/Tavily Provider 配置 |
| | `src/mcp/index.ts` | MCP 工厂 |
| | `src/config/schema.ts:343-352` | 配置 Schema |
| **Web Fetch** | 权限控制：`src/config/schema.ts` | 权限配置 |
| | `src/hooks/tool-output-truncator.ts` | 输出截断 |
| **Deep Research** | `src/agents/librarian.ts` | Librarian Agent 实现 |
| **Browser 自动化** | `src/config/schema.ts:331-341` | Provider 配置 |
| | `src/features/builtin-skills/skills/playwright.ts` | Playwright/agent-browser skill |
| | `src/features/builtin-skills/skills.ts` | Skill 工厂 |
| **Context7** | `src/mcp/context7.ts` | 文档查询 MCP |
| **grep_app** | `src/mcp/grep-app.ts` | GitHub 代码搜索 MCP |

---

## 七、oh-my-opencode vs opencode 对比

### 7.1 Web Search 对比

| 特性 | oh-my-opencode | opencode |
|------|---------------|----------|
| **架构** | Remote MCP | 直接调用 Exa API |
| **Provider** | Exa / Tavily (可配置) | Exa (固定) |
| **API Key** | 可选 (EXA_API_KEY) | 无需 |
| **配置方式** | `websearch.provider` 配置项 | 硬编码 |
| **代码位置** | `src/mcp/websearch.ts` | `packages/opencode/src/tool/websearch.ts` |

**opencode Web Search 核心代码：**
```typescript
// packages/opencode/src/tool/websearch.ts
const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  DEFAULT_NUM_RESULTS: 8,
} as const

// 直接调用 Exa MCP API
const response = await fetch(`${API_CONFIG.BASE_URL}/mcp`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(searchRequest),
})

// 支持的参数
interface ExaSearchParams {
  query: string
  numResults?: number
  livecrawl?: "fallback" | "preferred"  // 实时爬取模式
  type?: "auto" | "fast" | "deep"       // 搜索深度
  contextMaxCharacters?: number          // 上下文最大字符数
}
```

**oh-my-opencode Web Search 核心代码：**
```typescript
// src/mcp/websearch.ts
export function createWebsearchConfig(config?: WebsearchConfig): RemoteMcpConfig {
  const provider = config?.provider || "exa"  // 支持切换 Provider
  // 返回 MCP 配置对象，由系统统一管理
}
```

### 7.2 Web Fetch 对比

| 特性 | oh-my-opencode | opencode |
|------|---------------|----------|
| **实现方式** | 依赖 MCP 工具 | 内部实现 |
| **HTML 转换** | 无 | `turndown` 库 → Markdown |
| **大小限制** | 通过 token 截断 (10k tokens) | 5MB 响应体限制 |
| **超时** | 无 | 默认 30s，可配置 max 120s |
| **格式支持** | MCP 返回格式 | text / markdown / html |

**opencode Web Fetch 核心代码：**
```typescript
// packages/opencode/src/tool/webfetch.ts
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

export const WebFetchTool = Tool.define("webfetch", {
  parameters: z.object({
    url: z.string(),
    format: z.enum(["text", "markdown", "html"]).default("markdown"),
    timeout: z.number().optional(),
  }),
  async execute(params, ctx) {
    // 1. 权限检查
    await ctx.ask({ permission: "webfetch", patterns: [params.url] })
    
    // 2. 构建请求头（根据 format）
    const acceptHeader = params.format === "markdown" 
      ? "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8"
      : ...
    
    // 3. 获取内容
    const response = await fetch(params.url, { signal, headers })
    
    // 4. 大小检查
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error("Response too large (exceeds 5MB limit)")
    }
    
    // 5. 格式转换
    switch (params.format) {
      case "markdown":
        if (contentType.includes("text/html")) {
          const markdown = convertHTMLToMarkdown(content)  // 使用 turndown
        }
    }
  }
})

// HTML 转 Markdown
function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({ headingStyle: "atx" })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}

// 提取纯文本
async function extractTextFromHTML(html: string) {
  const rewriter = new HTMLRewriter()
    .on("script, style, noscript, iframe, object, embed", {
      element() { skipContent = true }
    })
    .transform(new Response(html))
  return await rewriter.text()
}
```

### 7.3 长内容处理对比

| 特性 | oh-my-opencode | opencode |
|------|---------------|----------|
| **截断机制** | Token 级别智能截断 | 字节级别大小限制 |
| **截断策略** | 保留头部 + 逐行添加 + 动态感知 | 硬性 5MB 限制 |
| **截断位置** | Hook 层 (tool.execute.after) | 工具执行层 |
| **保留头部** | 是 (默认 3 行) | 否 |
| **动态感知** | 是 (根据剩余 context 调整) | 否 |

**oh-my-opencode 智能截断：**
```typescript
// src/shared/dynamic-truncator.ts
const maxOutputTokens = Math.min(
  usage.remainingTokens * 0.5,  // 动态：保留 50% 空间
  targetMaxTokens,              // 工具指定限制
)
```

### 7.4 架构差异总结

| 维度 | oh-my-opencode | opencode |
|------|---------------|----------|
| **Web Search** | MCP 代理模式 (可切换 Provider) | 直连 Exa API |
| **Web Fetch** | 依赖外部 MCP | 内部实现 + turndown 转换 |
| **截断策略** | 智能 + 动态 | 硬性限制 |
| **复杂度** | 低 (MCP 统一管理) | 中 (内部实现更多控制) |
| **灵活性** | 高 (Provider 可配置) | 低 (固定 Exa) |

---

## 九、openclaw 实现分析

### 9.1 Web Search 实现

openclaw 的 Web Search 采用**双 Provider 架构**，支持 Brave Search 和 Perplexity：

**文件：`src/agents/tools/web-search.ts`**

| Provider | API | 特点 |
|----------|-----|------|
| **Brave Search** | `api.search.brave.com` | 传统搜索，返回 URL + 摘要 |
| **Perplexity** | `openrouter.ai` 或 `api.perplexity.ai` | LLM 合成答案 + 引用 |

**Brave Search 返回格式：**
```typescript
{
  results: [
    {
      title: "React Documentation",
      url: "https://react.dev",
      description: "A JavaScript library for building user interfaces...",
      published: "2 weeks ago",
      siteName: "react.dev"
    }
  ]
}
```

**Perplexity 返回格式：**
```typescript
{
  content: "LLM 生成的答案...",  // AI 合成答案
  citations: ["https://...", "https://..."]  // 引用来源
}
```

### 9.2 Web Fetch 实现

openclaw 的 Web Fetch 更加完善，支持**多层fallback 机制**：

**文件：`src/agents/tools/web-fetch.ts`**

```typescript
// 提取优先级：
// 1. Readability (Mozilla readability 库) - 提取页面主要内容
// 2. Fallback: Firecrawl API - 如果 Readability 失败
// 3. Fallback: 原生 fetch - 最后手段

// 提取模式：
// - markdown (默认)
// - text

// 大小限制：
// - 默认: 50,000 字符
// - 可配置 maxChars 参数
```

**核心特点：**
1. **Readability 库** - Mozilla 的 readability 算法，提取页面主要内容（去广告、导航）
2. **Firecrawl Fallback** - 当 Readability 失败时，自动使用 Firecrawl API
3. **自动重试** - fetch 失败时自动尝试 Firecrawl
4. **多格式支持** - markdown / text 两种输出格式

### 9.3 与 oh-my-opencode 对比

| 特性 | openclaw | oh-my-opencode |
|------|----------|---------------|
| **Web Search Provider** | Brave + Perplexity | Exa + Tavily |
| **Perplexity 支持** | ✅ LLM 合成答案 | ❌ |
| **Web Fetch 提取** | Readability + Firecrawl | 依赖 MCP |
| **Firecrawl Fallback** | ✅ 自动降级 | ❌ |
| **缓存机制** | ✅ 内置缓存 | MCP 层面处理 |
| **截断策略** | 字符数限制 (50k) | Token 截断 (10k) |

### 9.4 openclaw 独特设计

1. **LLM 增强搜索** - Perplexity provider 直接返回 LLM 合成答案
2. **智能 fallback** - Web Fetch 多层降级机制
3. **内容提取** - 使用 Readability 算法净化页面
4. **安全包装** - 内容用特殊标记包裹，提示 LLM 来自外部

---

## 十、总结：三者 Web 能力对比

| 项目 | Web Search | Web Fetch | Deep Research |
|------|------------|-----------|---------------|
| **oh-my-opencode** | Exa/Tavily MCP | 依赖 MCP | Librarian Agent (分类 + 并行) |
| **openclaw** | Brave/Perplexity | Readability + Firecrawl | Sub-agent 机制 |
| **opencode** | Exa API | turndown 转换 | - |

---

## 十一、开源替代方案

### 1. SearXNG - Brave Search 替代

**SearXNG** 是开源元搜索引擎，聚合 70+ 搜索服务：

| 特性 | 说明 |
|------|------|
| **Stars** | 开源活跃 |
| **自托管** | ✅ Docker 一键部署 |
| **隐私** | 不追踪/不记录用户 |
| **搜索源** | Google, Bing, DuckDuckGo 等 70+ 服务 |
| **用法** | 搜索聚合，结果去重排序 |

```bash
# 一键部署
docker run --rm -d -p 8080:8080 -v ./searxng:/etc/searxng --name searxng searxng/searxng

# 使用
curl "http://localhost:8080/search?q=react+hooks"
```

### 2. Perplexica - Perplexity 替代

**Perplexica** 是最接近 Perplexity 的开源实现：

| 特性 | 说明 |
|------|------|
| **Stars** | 28.9k |
| **架构** | SearXNG (搜索) + LLM (合成答案) |
| **自托管** | ✅ Docker 支持 |
| **LLM 支持** | 本地 (Ollama) / 云端 (OpenAI/Claude/Gemini) |
| **模式** | Speed / Balanced / Quality |
| **搜索来源** | Web / Academic / YouTube / Reddit |

**搜索模式：**
- **All Modes** - 综合搜索
- **Academic** - 学术论文
- **YouTube** - 视频
- **Reddit** - 社区讨论

**架构图：**
```
用户问题 → SearXNG (搜索) → 内容提取 → LLM (合成答案) → 带引用答案
```

```bash
# 部署 (需要 Ollama + SearXNG)
# 1. 安装 Ollama 并下载模型
ollama pull llama3.2

# 2. 使用 Docker Compose 部署 Perplexica
git clone https://github.com/ItzCrazyKns/Perplexica.git
cd Perplexica
cp sample.config.toml config.toml
docker compose up -d
```

### 3. Whoogle - 轻量级隐私搜索

**Whoogle** 是轻量级开源搜索代理：

| 特性 | 说明 |
|------|------|
| **功能** | 代理 Google 搜索，去广告/AMP/追踪 |
| **部署** | Docker / Heroku |
| **隐私** | 无 cookies / 无追踪 |

```bash
# 部署
docker run -p 5000:5000 --env PORT=5000 benbusby/whoogle-search
```

### 4. Readability - 内容提取（已开源）

| 特性 | 说明 |
|------|------|
| **来源** | Firefox 阅读模式核心算法 |
| **开源** | ✅ Mozilla @mozilla/readability |
| **API Key** | ❌ 不需要，完全免费 |
| **用途** | 从 HTML 提取正文，去除广告/导航 |

---

## 十二、总结：开源 vs 闭源

| 闭源工具 | 开源替代 | 自托管 | LLM 合成 |
|----------|----------|--------|----------|
| Exa | ❌ | ❌ | ❌ |
| Tavily | ❌ | ❌ | ❌ |
| Brave Search | **SearXNG** / Whoogle | ✅ | ❌ |
| Perplexity | **Perplexica** ⭐ | ✅ | ✅ |
| Firecrawl | **SearXNG + 自建** | ✅ | - |
| Readability | ❌ (本身开源) | - | - |
