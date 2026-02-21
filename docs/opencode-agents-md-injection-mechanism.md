# OpenCode 与 OpenClaw AGENTS.md 动态注入 Prompt 机制分析

本文档分析 OpenCode 和 OpenClaw 两个项目中 AGENTS.md 及其他 markdown 文件如何被动态注入到 LLM 的 prompt 中，并进行对比分析。

---

# 第一部分：OpenCode 实现分析

---

## 一、机制概述

OpenCode 实现了两层注入机制：

1. **静态注入（会话初始化时）**：在会话开始时，将项目级和全局级的 AGENTS.md 文件内容注入到系统提示中
2. **动态注入（读取文件时）**：当使用 Read tool 读取某个文件时，自动查找并注入该文件父目录中的 AGENTS.md

---

## 二、核心文件路径

| 文件绝对路径 | 作用 |
|-------------|------|
| `D:/document/zhishitong_workspace/zst_project/tong_work/thirdparty/opencode/packages/opencode/src/session/instruction.ts` | **核心模块** - 负责加载和解析 AGENTS.md 等 instruction 文件 |
| `D:/document/zhishitong_workspace/zst_project/tong_work/thirdparty/opencode/packages/opencode/src/session/prompt.ts` | **注入入口** - 将 instruction 内容注入到系统提示中 |
| `D:/document/zhishitong_workspace/zst_project/tong_work/thirdparty/opencode/packages/opencode/src/tool/read.ts` | **动态注入** - 在读取文件时动态注入父目录的 AGENTS.md |
| `D:/document/zhishitong_workspace/zst_project/tong_work/thirdparty/opencode/packages/opencode/src/util/filesystem.ts` | **工具函数** - 提供 `findUp` 和 `globUp` 向上查找文件 |
| `D:/document/zhishitong_workspace/zst_project/tong_work/thirdparty/opencode/packages/opencode/src/config/config.ts` | **配置定义** - 定义 `instructions` 配置字段 |
| `D:/document/zhishitong_workspace/zst_project/tong_work/thirdparty/opencode/packages/opencode/src/session/system.ts` | **环境提示** - 生成环境信息的系统提示 |

---

## 三、支持的文件类型

### 3.1 文件优先级

**文件**: `instruction.ts` (第 13-17 行)

```typescript
const FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md", // deprecated
]
```

支持的 instruction 文件按优先级排序：`AGENTS.md` > `CLAUDE.md` > `CONTEXT.md`（后者已弃用）

### 3.2 全局文件位置

**文件**: `instruction.ts` (第 19-29 行)

```typescript
function globalFiles() {
  const files = []
  if (Flag.OPENCODE_CONFIG_DIR) {
    files.push(path.join(Flag.OPENCODE_CONFIG_DIR, "AGENTS.md"))
  }
  files.push(path.join(Global.Path.config, "AGENTS.md"))
  if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT) {
    files.push(path.join(os.homedir(), ".claude", "CLAUDE.md"))
  }
  return files
}
```

全局文件查找顺序：
1. `OPENCODE_CONFIG_DIR/AGENTS.md`（环境变量指定）
2. `~/.config/opencode/AGENTS.md`（默认全局配置目录）
3. `~/.claude/CLAUDE.md`（Claude Code 兼容）

---

## 四、静态注入流程

### 4.1 系统路径解析

**文件**: `instruction.ts` (第 71-116 行)

```typescript
export async function systemPaths() {
  const config = await Config.get()
  const paths = new Set<string>()

  // 1. 查找项目级别的 AGENTS.md（从当前目录向上查找）
  if (!Flag.OPENCODE_DISABLE_PROJECT_CONFIG) {
    for (const file of FILES) {
      const matches = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
      if (matches.length > 0) {
        matches.forEach((p) => {
          paths.add(path.resolve(p))
        })
        break
      }
    }
  }

  // 2. 查找全局级别的 AGENTS.md（只取第一个存在的）
  for (const file of globalFiles()) {
    if (await Bun.file(file).exists()) {
      paths.add(path.resolve(file))
      break
    }
  }

  // 3. 处理配置中的自定义 instructions
  if (config.instructions) {
    for (let instruction of config.instructions) {
      if (instruction.startsWith("https://") || instruction.startsWith("http://")) continue
      if (instruction.startsWith("~/")) {
        instruction = path.join(os.homedir(), instruction.slice(2))
      }
      const matches = path.isAbsolute(instruction)
        ? await Array.fromAsync(
            new Bun.Glob(path.basename(instruction)).scan({
              cwd: path.dirname(instruction),
              absolute: true,
              onlyFiles: true,
            }),
          ).catch(() => [])
        : await resolveRelative(instruction)
      matches.forEach((p) => {
        paths.add(path.resolve(p))
      })
    }
  }

  return paths
}
```

**作用说明**：
- **步骤 1**：从项目目录向上查找 AGENTS.md/CLAUDE.md，直到 worktree 根目录
- **步骤 2**：查找全局配置目录中的 AGENTS.md（只取第一个存在的）
- **步骤 3**：解析 `opencode.json` 中配置的自定义 instructions（支持 glob 模式）

### 4.2 生成系统提示内容

**文件**: `instruction.ts` (第 118-145 行)

```typescript
export async function system() {
  const config = await Config.get()
  const paths = await systemPaths()

  // 读取本地文件
  const files = Array.from(paths).map(async (p) => {
    const content = await Bun.file(p)
      .text()
      .catch(() => "")
    return content ? "Instructions from: " + p + "\n" + content : ""
  })

  // 处理远程 URL
  const urls: string[] = []
  if (config.instructions) {
    for (const instruction of config.instructions) {
      if (instruction.startsWith("https://") || instruction.startsWith("http://")) {
        urls.push(instruction)
      }
    }
  }
  const fetches = urls.map((url) =>
    fetch(url, { signal: AbortSignal.timeout(5000) })
      .then((res) => (res.ok ? res.text() : ""))
      .catch(() => "")
      .then((x) => (x ? "Instructions from: " + url + "\n" + x : "")),
  )

  return Promise.all([...files, ...fetches]).then((result) => result.filter(Boolean))
}
```

**输出格式**：
```
Instructions from: /path/to/AGENTS.md
<AGENTS.md 的完整内容>
```

### 4.3 注入到系统提示

**文件**: `prompt.ts` (第 603-622 行)

```typescript
const result = await processor.process({
  user: lastUser,
  agent,
  abort,
  sessionID,
  // ⭐ 关键：将 InstructionPrompt.system() 结果注入到 system 数组
  system: [...(await SystemPrompt.environment(model)), ...(await InstructionPrompt.system())],
  messages: [
    ...MessageV2.toModelMessages(sessionMessages, model),
    ...(isLastStep
      ? [
          {
            role: "assistant" as const,
            content: MAX_STEPS,
          },
        ]
      : []),
  ],
  tools,
  model,
})
```

**注入顺序**：
1. `SystemPrompt.environment(model)` - 环境信息（工作目录、git 状态、平台等）
2. `InstructionPrompt.system()` - AGENTS.md 等 instruction 内容

---

## 五、动态注入流程

### 5.1 Read Tool 中的触发

**文件**: `read.ts` (第 63, 140-142 行)

```typescript
export const ReadTool = Tool.define("read", {
  // ...
  async execute(params, ctx) {
    // ...

    // 在读取文件前，解析相关 instruction
    const instructions = await InstructionPrompt.resolve(ctx.messages, filepath, ctx.messageID)

    // ... 读取文件内容 ...

    // 将 instruction 内容追加到输出中
    if (instructions.length > 0) {
      output += `\n\n<system-reminder>\n${instructions.map((i) => i.content).join("\n\n")}\n</system-reminder>`
    }

    return {
      title,
      output,
      metadata: {
        preview,
        truncated,
        ...(instructions.length > 0 && { loaded: instructions.map((i) => i.filepath) }),
      },
    }
  },
})
```

### 5.2 动态解析父目录 AGENTS.md

**文件**: `instruction.ts` (第 171-196 行)

```typescript
export async function resolve(messages: MessageV2.WithParts[], filepath: string, messageID: string) {
  const system = await systemPaths()
  const already = loaded(messages)
  const results: { filepath: string; content: string }[] = []

  const target = path.resolve(filepath)
  let current = path.dirname(target)
  const root = path.resolve(Instance.directory)

  // 从文件所在目录向上查找到项目根目录
  while (current.startsWith(root) && current !== root) {
    const found = await find(current)

    // 排除：已在系统提示中的、已加载过的、已声明过的
    if (found && found !== target && !system.has(found) && !already.has(found) && !isClaimed(messageID, found)) {
      claim(messageID, found)
      const content = await Bun.file(found)
        .text()
        .catch(() => undefined)
      if (content) {
        results.push({ filepath: found, content: "Instructions from: " + found + "\n" + content })
      }
    }
    current = path.dirname(current)
  }

  return results
}
```

**防止重复加载机制**：

```typescript
// 第 51-65 行
function isClaimed(messageID: string, filepath: string) {
  const claimed = state().claims.get(messageID)
  if (!claimed) return false
  return claimed.has(filepath)
}

function claim(messageID: string, filepath: string) {
  const current = state()
  let claimed = current.claims.get(messageID)
  if (!claimed) {
    claimed = new Set()
    current.claims.set(messageID, claimed)
  }
  claimed.add(filepath)
}
```

---

## 六、工具函数

### 6.1 findUp - 向上查找文件

**文件**: `filesystem.ts` (第 39-51 行)

```typescript
export async function findUp(target: string, start: string, stop?: string) {
  let current = start
  const result = []
  while (true) {
    const search = join(current, target)
    if (await exists(search)) result.push(search)
    if (stop === current) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return result
}
```

### 6.2 globUp - 向上 Glob 匹配

**文件**: `filesystem.ts` (第 68-92 行)

```typescript
export async function globUp(pattern: string, start: string, stop?: string) {
  let current = start
  const result = []
  while (true) {
    try {
      const glob = new Bun.Glob(pattern)
      for await (const match of glob.scan({
        cwd: current,
        absolute: true,
        onlyFiles: true,
        followSymlinks: true,
        dot: true,
      })) {
        result.push(match)
      }
    } catch {
      // Skip invalid glob patterns
    }
    if (stop === current) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return result
}
```

---

## 七、配置定义

**文件**: `config.ts` (第 1107 行)

```typescript
instructions: z.array(z.string()).optional().describe("Additional instruction files or patterns to include"),
```

---

## 八、配置示例

### 8.1 opencode.json 配置自定义 instructions

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": [
    "CONTRIBUTING.md",
    "docs/guidelines.md",
    ".cursor/rules/*.md",
    "packages/*/AGENTS.md",
    "https://raw.githubusercontent.com/my-org/shared-rules/main/style.md"
  ]
}
```

支持的格式：
- 相对路径：`CONTRIBUTING.md`
- Glob 模式：`.cursor/rules/*.md`
- 绝对路径：`/absolute/path/to/file.md`
- Home 目录：`~/config/instructions.md`
- 远程 URL：`https://example.com/rules.md`（5 秒超时）

---

## 九、流程图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        AGENTS.md 注入流程                                │
└─────────────────────────────────────────────────────────────────────────┘

1. 会话初始化时（静态注入）
   ┌──────────────┐      ┌───────────────────┐      ┌─────────────────┐
   │ systemPaths()│ ───▶ │ 查找项目 AGENTS.md │ ───▶ │ 查找全局文件     │
   └──────────────┘      │ (findUp 向上查找) │      │ ~/.config/...   │
                         └───────────────────┘      └─────────────────┘
                                   │                        │
                                   └────────────┬───────────┘
                                                ▼
                              ┌────────────────────────────────┐
                              │ 合并 config.instructions 配置   │
                              │ (支持 glob 和远程 URL)          │
                              └────────────────────────────────┘
                                                │
                                                ▼
                              ┌────────────────────────────────┐
                              │ system() 读取所有文件内容        │
                              │ 格式化为 "Instructions from:..." │
                              └────────────────────────────────┘
                                                │
                                                ▼
                              ┌────────────────────────────────┐
                              │ 注入到 processor.process() 的   │
                              │ system 参数数组中                │
                              └────────────────────────────────┘

2. 读取文件时（动态注入）
   ┌──────────────┐      ┌─────────────────────────────────────┐
   │ Read tool    │ ───▶ │ resolve(filepath, messageID)        │
   │ 执行         │      │ 查找该文件父目录中的 AGENTS.md        │
   └──────────────┘      └─────────────────────────────────────┘
                │                        │
                │                        ▼
                │          ┌─────────────────────────────────────┐
                │          │ 排除：                               │
                │          │ - 已在系统提示中的 (system)           │
                │          │ - 本次会话已加载的 (already)         │
                │          │ - 被其他 tool call 声明的 (claimed)  │
                │          └─────────────────────────────────────┘
                │                        │
                ▼                        ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ 将 instruction 内容包裹在 <system-reminder> 标签中           │
   │ 追加到文件读取结果的 output 字段                              │
   └─────────────────────────────────────────────────────────────┘
```

---

## 十、优先级规则总结

1. **项目级**: `AGENTS.md` > `CLAUDE.md` > `CONTEXT.md`（只取第一个存在的）
2. **全局级**: `~/.config/opencode/AGENTS.md` > `~/.claude/CLAUDE.md`
3. **自定义 instructions**: 通过 `opencode.json` 配置，支持 glob 和远程 URL
4. **动态注入**: 子目录 AGENTS.md 在读取该目录文件时自动加载

---

## 十一、关键设计点

1. **去重机制**：通过 `claims` Map 确保同一 messageID 下不会重复加载同一 instruction 文件
2. **已加载追踪**：通过 `loaded()` 函数检查历史消息中的 Read tool 已加载过的文件
3. **系统提示排除**：动态注入时会排除已在系统提示中的文件，避免重复
4. **远程支持**：支持从 URL 加载 instruction，超时 5 秒
5. **Glob 模式**：配置中支持 glob 模式批量匹配多个 instruction 文件

---

# 第二部分：OpenClaw 实现分析

## 一、机制概述

OpenClaw 采用 **"预注入"** 模式：在会话初始化时，将工作区目录下的多个 bootstrap 文件（AGENTS.md、SOUL.md、TOOLS.md 等）内容直接嵌入到系统提示的 "Project Context" 部分。

**与 OpenCode 的主要区别**：
- OpenClaw 支持更多文件类型（8 种），OpenCode 主要支持 AGENTS.md/CLAUDE.md
- OpenClaw 采用静态预注入，OpenCode 同时支持静态注入和动态注入
- OpenClaw 支持文件截断，OpenCode 不支持

---

## 二、核心文件路径

| 文件绝对路径 | 作用 |
|-------------|------|
| `D:/document/zhishitong_workspace/zst_project/tong_work/thirdparty/openclaw/src/agents/workspace.ts` | **文件名定义与加载** - 定义 bootstrap 文件名常量，提供加载函数 |
| `D:/document/zhishitong_workspace/zst_project/tong_work/thirdparty/openclaw/src/agents/pi-embedded-helpers/bootstrap.ts` | **内容构建** - 构建 EmbeddedContextFile，支持截断 |
| `D:/document/zhishitong_workspace/zst_project/tong_work/thirdparty/openclaw/src/agents/system-prompt.ts` | **系统提示注入** - 将 contextFiles 注入到 "Project Context" 部分 |
| `D:/document/zhishitong_workspace/zst_project/tong_work/thirdparty/openclaw/src/agents/bootstrap-files.ts` | **解析入口** - resolveBootstrapContextForRun 统一入口 |
| `D:/document/zhishitong_workspace/zst_project/tong_work/thirdparty/openclaw/src/agents/pi-embedded-runner/run/attempt.ts` | **运行时调用** - 运行时调用链入口 |

---

## 三、支持的文件类型

**文件**: `workspace.ts` (第 21-29 行)

```typescript
export const DEFAULT_AGENTS_FILENAME = "AGENTS.md";
export const DEFAULT_SOUL_FILENAME = "SOUL.md";
export const DEFAULT_TOOLS_FILENAME = "TOOLS.md";
export const DEFAULT_IDENTITY_FILENAME = "IDENTITY.md";
export const DEFAULT_USER_FILENAME = "USER.md";
export const DEFAULT_HEARTBEAT_FILENAME = "HEARTBEAT.md";
export const DEFAULT_BOOTSTRAP_FILENAME = "BOOTSTRAP.md";
export const DEFAULT_MEMORY_FILENAME = "MEMORY.md";
export const DEFAULT_MEMORY_ALT_FILENAME = "memory.md";
```

| 文件名 | 用途 |
|--------|------|
| `AGENTS.md` | Agent 行为规范（类似 OpenCode） |
| `SOUL.md` | 人格/风格定义（注入时会添加特殊提示） |
| `TOOLS.md` | 工具使用指导 |
| `IDENTITY.md` | 身份信息 |
| `USER.md` | 用户偏好 |
| `HEARTBEAT.md` | 心跳响应指导 |
| `BOOTSTRAP.md` | 启动引导信息 |
| `MEMORY.md` / `memory.md` | 记忆/持久化信息 |

---

## 四、文件加载流程

### 4.1 加载工作区 Bootstrap 文件

**文件**: `workspace.ts` (第 237-260 行)

```typescript
export async function loadWorkspaceBootstrapFiles(dir: string): Promise<WorkspaceBootstrapFile[]> {
  const resolvedDir = resolveUserPath(dir);

  const entries: Array<{
    name: WorkspaceBootstrapFileName;
    filePath: string;
  }> = [
    { name: DEFAULT_AGENTS_FILENAME, filePath: path.join(resolvedDir, DEFAULT_AGENTS_FILENAME) },
    { name: DEFAULT_SOUL_FILENAME, filePath: path.join(resolvedDir, DEFAULT_SOUL_FILENAME) },
    { name: DEFAULT_TOOLS_FILENAME, filePath: path.join(resolvedDir, DEFAULT_TOOLS_FILENAME) },
    { name: DEFAULT_IDENTITY_FILENAME, filePath: path.join(resolvedDir, DEFAULT_IDENTITY_FILENAME) },
    { name: DEFAULT_USER_FILENAME, filePath: path.join(resolvedDir, DEFAULT_USER_FILENAME) },
    { name: DEFAULT_HEARTBEAT_FILENAME, filePath: path.join(resolvedDir, DEFAULT_HEARTBEAT_FILENAME) },
    { name: DEFAULT_BOOTSTRAP_FILENAME, filePath: path.join(resolvedDir, DEFAULT_BOOTSTRAP_FILENAME) },
  ];

  // 还会加载 MEMORY.md / memory.md
  entries.push(...(await resolveMemoryBootstrapEntries(resolvedDir)));

  const result: WorkspaceBootstrapFile[] = [];
  for (const entry of entries) {
    try {
      const content = await fs.readFile(entry.filePath, "utf-8");
      result.push({ name: entry.name, path: entry.filePath, content, missing: false });
    } catch {
      result.push({ name: entry.name, path: entry.filePath, missing: true });
    }
  }
  return result;
}
```

### 4.2 构建上下文文件（支持截断）

**文件**: `bootstrap.ts` (第 103-136 行)

```typescript
const DEFAULT_BOOTSTRAP_MAX_CHARS = 20000;  // 默认最大 20,000 字符
const BOOTSTRAP_HEAD_RATIO = 0.7;           // 保留 70% 头部
const BOOTSTRAP_TAIL_RATIO = 0.2;           // 保留 20% 尾部

function trimBootstrapContent(
  content: string,
  fileName: string,
  maxChars: number,
): TrimBootstrapResult {
  const trimmed = content.trimEnd();
  if (trimmed.length <= maxChars) {
    return { content: trimmed, truncated: false, maxChars, originalLength: trimmed.length };
  }

  const headChars = Math.floor(maxChars * BOOTSTRAP_HEAD_RATIO);
  const tailChars = Math.floor(maxChars * BOOTSTRAP_TAIL_RATIO);
  const head = trimmed.slice(0, headChars);
  const tail = trimmed.slice(-tailChars);

  const marker = [
    "",
    `[...truncated, read ${fileName} for full content...]`,
    `…(truncated ${fileName}: kept ${headChars}+${tailChars} chars of ${trimmed.length})…`,
    "",
  ].join("\n");
  const contentWithMarker = [head, marker, tail].join("\n");
  return { content: contentWithMarker, truncated: true, maxChars, originalLength: trimmed.length };
}
```

**截断策略**：
- 超过 20,000 字符时自动截断
- 保留 70% 头部 + 20% 尾部（共 90%，剩余 10% 用于标记）
- 插入截断标记提示

### 4.3 构建上下文文件列表

**文件**: `bootstrap.ts` (第 162-191 行)

```typescript
export function buildBootstrapContextFiles(
  files: WorkspaceBootstrapFile[],
  opts?: { warn?: (message: string) => void; maxChars?: number },
): EmbeddedContextFile[] {
  const maxChars = opts?.maxChars ?? DEFAULT_BOOTSTRAP_MAX_CHARS;
  const result: EmbeddedContextFile[] = [];
  for (const file of files) {
    if (file.missing) {
      result.push({
        path: file.name,
        content: `[MISSING] Expected at: ${file.path}`,
      });
      continue;
    }
    const trimmed = trimBootstrapContent(file.content ?? "", file.name, maxChars);
    if (!trimmed.content) continue;
    if (trimmed.truncated) {
      opts?.warn?.(
        `workspace bootstrap file ${file.name} is ${trimmed.originalLength} chars (limit ${trimmed.maxChars}); truncating in injected context`,
      );
    }
    result.push({
      path: file.name,
      content: trimmed.content,
    });
  }
  return result;
}
```

---

## 五、系统提示注入

### 5.1 注入位置

**文件**: `system-prompt.ts` (第 551-568 行)

```typescript
const contextFiles = params.contextFiles ?? [];
if (contextFiles.length > 0) {
  const hasSoulFile = contextFiles.some((file) => {
    const normalizedPath = file.path.trim().replace(/\\/g, "/");
    const baseName = normalizedPath.split("/").pop() ?? normalizedPath;
    return baseName.toLowerCase() === "soul.md";
  });
  lines.push("# Project Context", "", "The following project context files have been loaded:");
  if (hasSoulFile) {
    lines.push(
      "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
    );
  }
  lines.push("");
  for (const file of contextFiles) {
    lines.push(`## ${file.path}`, "", file.content, "");
  }
}
```

### 5.2 注入格式示例

```
# Project Context

The following project context files have been loaded:
If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.

## AGENTS.md

<AGENTS.md 文件内容>

## SOUL.md

<SOUL.md 文件内容>

## TOOLS.md

<TOOLS.md 文件内容>

...
```

### 5.3 SOUL.md 特殊处理

当检测到 SOUL.md 文件存在时，系统会添加额外提示：

```
If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.
```

这是 OpenClaw 独有的特性，允许用户定义 Agent 的人格和风格。

---

## 六、完整调用链

### 6.1 统一入口

**文件**: `bootstrap-files.ts` (第 43-60 行)

```typescript
export async function resolveBootstrapContextForRun(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  warn?: (message: string) => void;
}): Promise<{
  bootstrapFiles: WorkspaceBootstrapFile[];
  contextFiles: EmbeddedContextFile[];
}> {
  const bootstrapFiles = await resolveBootstrapFilesForRun(params);
  const contextFiles = buildBootstrapContextFiles(bootstrapFiles, {
    maxChars: resolveBootstrapMaxChars(params.config),
    warn: params.warn,
  });
  return { bootstrapFiles, contextFiles };
}
```

### 6.2 流程图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     OpenClaw AGENTS.md 注入流程                          │
└─────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────┐
│ 工作区目录                │
│ ~/.openclaw/workspace/   │
└────────────┬─────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────┐
│ loadWorkspaceBootstrapFiles()                            │
│ 读取 8 种文件：                                           │
│ - AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md             │
│ - USER.md, HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md        │
└────────────┬─────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────┐
│ buildBootstrapContextFiles()                             │
│ - 智能截断（超过 20,000 字符）                             │
│ - 格式化为 EmbeddedContextFile[]                         │
└────────────┬─────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────┐
│ system-prompt.ts                                         │
│ 注入到系统提示 "# Project Context" 部分                   │
│ - SOUL.md 特殊处理（人格/风格指导）                        │
└──────────────────────────────────────────────────────────┘
```

---

# 第三部分：OpenCode 与 OpenClaw 对比分析

## 一、核心差异对比表

| 特性 | OpenCode | OpenClaw |
|------|----------|----------|
| **支持的文件类型** | AGENTS.md, CLAUDE.md, CONTEXT.md | AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, USER.md, HEARTBEAT.md, BOOTSTRAP.md, MEMORY.md |
| **注入模式** | 静态注入 + 动态注入 | 仅静态预注入 |
| **注入位置** | system 参数数组 | 系统提示 "# Project Context" 部分 |
| **文件截断** | 不支持 | 支持（默认 20,000 字符，保留头部 70% + 尾部 20%） |
| **子目录支持** | 支持（动态注入父目录 AGENTS.md） | 不支持 |
| **全局文件** | 支持（~/.config/opencode/AGENTS.md） | 不支持（仅工作区目录） |
| **远程 URL** | 支持（5 秒超时） | 不支持 |
| **Glob 模式** | 支持（配置文件中） | 不支持 |
| **子代理过滤** | 不支持 | 支持（SUBAGENT_BOOTSTRAP_ALLOWLIST） |
| **Hook 覆盖** | 不支持 | 支持（applyBootstrapHookOverrides） |
| **人格/风格** | 不支持 | 支持（SOUL.md 特殊处理） |
| **去重机制** | 支持（claims Map + loaded()） | 不需要（单次加载） |

## 二、注入机制对比

### OpenCode - 双层注入

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenCode 注入机制                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 静态注入（会话初始化）                                        │
│     ┌──────────────┐                                            │
│     │ systemPaths()│ ──▶ 查找项目级 AGENTS.md                    │
│     └──────────────┘           │                                │
│                                ▼                                │
│                    ┌───────────────────────┐                    │
│                    │ 查找全局级 AGENTS.md   │                    │
│                    │ ~/.config/opencode/   │                    │
│                    └───────────┬───────────┘                    │
│                                ▼                                │
│                    ┌───────────────────────┐                    │
│                    │ 解析 config.instructions│                   │
│                    │ (支持 glob 和 URL)     │                    │
│                    └───────────┬───────────┘                    │
│                                ▼                                │
│                    ┌───────────────────────┐                    │
│                    │ 注入到 system 参数数组  │                    │
│                    └───────────────────────┘                    │
│                                                                 │
│  2. 动态注入（Read tool 执行时）                                 │
│     ┌──────────────┐                                            │
│     │ Read tool    │ ──▶ resolve() 查找父目录 AGENTS.md          │
│     └──────────────┘           │                                │
│                                ▼                                │
│                    ┌───────────────────────┐                    │
│                    │ 排除已加载的文件       │                    │
│                    │ (system/already/claimed)│                   │
│                    └───────────┬───────────┘                    │
│                                ▼                                │
│                    ┌───────────────────────┐                    │
│                    │ 追加到 output          │                    │
│                    │ <system-reminder>标签  │                    │
│                    └───────────────────────┘                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### OpenClaw - 单次预注入

```
┌─────────────────────────────────────────────────────────────────┐
│                       OpenClaw 注入机制                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  会话初始化时一次性加载所有文件                                    │
│                                                                 │
│  ┌──────────────────────────────────────────┐                   │
│  │ 工作区目录 ~/.openclaw/workspace/         │                   │
│  └────────────────────┬─────────────────────┘                   │
│                       │                                         │
│                       ▼                                         │
│  ┌──────────────────────────────────────────┐                   │
│  │ loadWorkspaceBootstrapFiles()             │                   │
│  │ 读取 8 种文件：                           │                   │
│  │ - AGENTS.md, SOUL.md, TOOLS.md           │                   │
│  │ - IDENTITY.md, USER.md, HEARTBEAT.md     │                   │
│  │ - BOOTSTRAP.md, MEMORY.md                │                   │
│  └────────────────────┬─────────────────────┘                   │
│                       │                                         │
│                       ▼                                         │
│  ┌──────────────────────────────────────────┐                   │
│  │ buildBootstrapContextFiles()              │                   │
│  │ - 智能截断（>20,000 字符）                │                   │
│  │ - 保留头部 70% + 尾部 20%                 │                   │
│  └────────────────────┬─────────────────────┘                   │
│                       │                                         │
│                       ▼                                         │
│  ┌──────────────────────────────────────────┐                   │
│  │ system-prompt.ts                          │                   │
│  │ 注入到 "# Project Context" 部分           │                   │
│  │ - SOUL.md 添加人格指导                    │                   │
│  └──────────────────────────────────────────┘                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 三、适用场景分析

### OpenCode 方案适合

1. **大型项目**：支持子目录 AGENTS.md，可以为不同模块提供针对性指导
2. **团队协作**：支持全局配置 + 项目配置，便于统一规范
3. **动态内容**：Read tool 时动态注入，减少初始上下文占用
4. **远程规则**：支持从 URL 加载共享规则

### OpenClaw 方案适合

1. **个人助理场景**：SOUL.md 提供人格定义，更人性化
2. **固定工作流**：多种文件类型对应不同用途，分工明确
3. **内容控制**：文件截断机制，避免上下文爆炸
4. **子代理场景**：支持子代理过滤，避免不必要的上下文传递

## 四、设计理念对比

| 维度 | OpenCode | OpenClaw |
|------|----------|----------|
| **核心理念** | 按需加载、动态注入 | 预加载、一次性注入 |
| **灵活性** | 高（glob、URL、子目录） | 中（固定文件类型） |
| **上下文效率** | 优化（动态注入减少初始占用） | 中等（截断机制控制大小） |
| **人格定制** | 无 | 有（SOUL.md） |
| **适用规模** | 大型项目/团队 | 个人/小团队 |

---

# 第四部分：对 agent-core 的启示

## 一、可借鉴的设计点

### 从 OpenCode 借鉴

1. **双层注入机制**：静态 + 动态，平衡初始上下文和灵活性
2. **去重机制**：claims Map + loaded() 确保不重复加载
3. **全局 + 项目配置**：支持全局规范和项目定制
4. **Glob 模式支持**：灵活匹配多个文件
5. **远程 URL 支持**：便于共享团队规则

### 从 OpenClaw 借鉴

1. **多文件类型**：分离不同用途的指导（工具、身份、记忆等）
2. **智能截断**：头部 + 尾部保留策略，确保关键信息不丢失
3. **人格/风格**：SOUL.md 类似的机制，让 Agent 更有个性
4. **子代理过滤**：避免向子代理传递不必要的上下文

## 二、建议实现方向

```typescript
// 建议的 instruction 配置结构
interface InstructionConfig {
  // 静态注入文件列表
  static: {
    files: string[];           // 文件路径或 glob 模式
    remoteUrls?: string[];     // 远程 URL
    globalPath?: string;       // 全局配置路径
  };
  
  // 动态注入配置
  dynamic: {
    enabled: boolean;          // 是否启用动态注入
    lookupScope: "parent" | "project" | "global";  // 查找范围
  };
  
  // 截断配置（借鉴 OpenClaw）
  truncation: {
    maxChars: number;          // 最大字符数
    headRatio: number;         // 头部保留比例
    tailRatio: number;         // 尾部保留比例
  };
  
  // 子代理配置（借鉴 OpenClaw）
  subagent: {
    allowlist?: string[];      // 允许传递给子代理的文件
  };
}
```

## 三、文件结构建议

```
项目根目录/
├── AGENTS.md              # Agent 行为规范（主文件）
├── .opencode/
│   ├── instructions/
│   │   ├── tools.md       # 工具使用指导
│   │   ├── identity.md    # 身份信息
│   │   └── memory.md      # 记忆/持久化
│   └── skills/            # Skills 目录
│       └── skill-name/
│           └── skill.md
└── opencode.json          # 配置文件
```
