# OpenCode AGENTS.md 实现原理详解

> **研究时间**: 2026-02-06  
> **研究对象**: thirdparty/opencode  
> **目的**: 理解 AGENTS.md 作为长期记忆的实现机制，为 Roy 项目提供参考

---

## 1. 整体架构

AGENTS.md 的加载分为两个层级：
- **系统级** (`InstructionPrompt.system()`) - 启动时加载，每轮 LLM 调用都注入
- **动态级** (`InstructionPrompt.resolve()`) - 读取文件时动态加载

---

## 2. 文件查找逻辑

### 2.1 向上遍历查找

**文件**: `packages/opencode/src/util/filesystem.ts`

```typescript
// 从起始目录向上查找目标文件，直到停止目录
export async function findUp(target: string, start: string, stop?: string) {
  let current = start
  const result = []
  while (true) {
    const search = join(current, target)
    if (await exists(search)) result.push(search)
    if (stop === current) break
    const parent = dirname(current)
    if (parent === current) break  // 到达文件系统根目录
    current = parent
  }
  return result
}
```

### 2.2 AGENTS.md 查找流程

**文件**: `packages/opencode/src/session/instruction.ts:14-30`

```typescript
const FILES = [
  "AGENTS.md",
  "CLAUDE.md",     // 备选
  "CONTEXT.md",    // 已弃用
]

// 项目级查找：从当前目录向上遍历到工作树根目录
for (const file of FILES) {
  const matches = await Filesystem.findUp(file, Instance.directory, Instance.worktree)
  if (matches.length > 0) {
    matches.forEach((p) => paths.add(path.resolve(p)))
    break  // 找到第一个就停止（优先级顺序）
  }
}
```

---

## 3. 加载优先级

### 3.1 全局文件优先级

**文件**: `packages/opencode/src/session/instruction.ts:22-28`

```typescript
function globalFiles() {
  const files = []
  // 1. 优先使用 OPENCODE_CONFIG_DIR
  if (Flag.OPENCODE_CONFIG_DIR) {
    files.push(path.join(Flag.OPENCODE_CONFIG_DIR, "AGENTS.md"))
  }
  // 2. 回退到全局配置目录
  files.push(path.join(Global.Path.config, "AGENTS.md"))
  // 3. Claude Code 兼容模式
  if (!Flag.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT) {
    files.push(path.join(os.homedir(), ".claude", "CLAUDE.md"))
  }
  return files
}
```

### 3.2 完整优先级（从高到低）

| 优先级 | 来源 | 环境变量/路径 |
|--------|------|--------------|
| 1 | OPENCODE_CONFIG_DIR | `$OPENCODE_CONFIG_DIR/AGENTS.md` |
| 2 | 全局配置 | `~/.config/opencode/AGENTS.md` |
| 3 | Claude Code 兼容 | `~/.claude/CLAUDE.md` |
| 4 | 项目本地 | 从当前目录向上找到的第一个 `AGENTS.md` |
| 5 | 配置中的 instructions | `opencode.json` 中的 `instructions` 数组 |

---

## 4. 三重去重机制

### 4.1 系统路径去重 (systemPaths)

**文件**: `packages/opencode/src/session/instruction.ts`

```typescript
const paths = new Set<string>()
// ... 各种加载逻辑
paths.add(path.resolve(p))  // Set 自动去重
return paths
```

### 4.2 消息级去重 (claims 机制)

**文件**: `packages/opencode/src/session/instruction.ts:85-100`

```typescript
const state = Instance.state(() => {
  return {
    claims: new Map<string, Set<string>>(),  // messageID -> 已加载文件集合
  }
})

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

### 4.3 历史消息去重 (loaded 函数)

**文件**: `packages/opencode/src/session/instruction.ts:115-130`

```typescript
export function loaded(messages: MessageV2.WithParts[]) {
  const paths = new Set<string>()
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool === "read") {
        const loaded = part.state.metadata?.loaded
        if (loaded && Array.isArray(loaded)) {
          for (const p of loaded) paths.add(p)
        }
      }
    }
  }
  return paths
}
```

### 4.4 完整去重检查流程

**文件**: `packages/opencode/src/session/instruction.ts:resolve()`

```typescript
export async function resolve(messages, filepath, messageID) {
  const system = await systemPaths()     // 系统级已加载
  const already = loaded(messages)       // 历史消息已加载
  
  if (found && 
      found !== target &&                // 不是正在读取的文件本身
      !system.has(found) &&              // 不在系统路径中
      !already.has(found) &&             // 不在历史加载中
      !isClaimed(messageID, found)) {    // 未被当前消息加载过
    claim(messageID, found)
    // 添加到结果...
  }
}
```

---

## 5. 注入时机

### 5.1 系统级注入（每次 LLM 调用）

**文件**: `packages/opencode/src/session/prompt.ts:602`

```typescript
const result = await processor.process({
  user: lastUser,
  agent,
  abort,
  sessionID,
  system: [
    ...(await SystemPrompt.environment(model)),   // 环境信息
    ...(await InstructionPrompt.system()),         // AGENTS.md 内容
  ],
  messages: [...],
  tools,
  model,
})
```

**触发时机**:
- 用户发送新消息时
- 工具执行后需要继续对话时
- 多轮对话的每一次请求

### 5.2 动态注入（Read 工具执行时）

**文件**: `packages/opencode/src/tool/read.ts:63,140-142`

```typescript
async execute(params, ctx) {
  // 1. 解析并加载相关的 AGENTS.md
  const instructions = await InstructionPrompt.resolve(ctx.messages, filepath, ctx.messageID)
  
  // 2. 读取文件内容...
  
  // 3. 将 instructions 作为 system-reminder 附加到输出
  if (instructions.length > 0) {
    output += `\n\n<system-reminder>\n${instructions.map((i) => i.content).join("\n\n")}\n</system-reminder>`
  }

  return {
    output,
    metadata: {
      // 4. 记录已加载的文件，用于后续去重
      loaded: instructions.map((i) => i.filepath)
    }
  }
}
```

---

## 6. 动态注入的触发时机

### 6.1 用户输入文件路径时（最常见）

**文件**: `packages/opencode/src/session/prompt.ts:1021`

```typescript
case "file:":
  // ... 
  await ReadTool.init()
    .then(async (t) => {
      const result = await t.execute(args, readCtx)  // ← 触发 read 工具
      // result.output 已包含 <system-reminder> 的 AGENTS.md 内容
    })
```

**触发场景**:
- 用户通过 `@` 或拖拽方式添加文件到对话
- Agent 内部通过 `file://path` 格式引用文件

### 6.2 AI 主动调用 Read 工具

当 AI 决定使用 `read` 工具读取文件时，会自动触发 AGENTS.md 的动态加载。

### 6.3 动态加载示例

假设项目结构：
```
/project
├── AGENTS.md          ← 根目录（已在系统提示中）
├── src/
│   ├── AGENTS.md      ← src 目录
│   └── utils/
│       ├── AGENTS.md  ← utils 目录
│       └── helper.ts
```

**场景 1**: 读取 `src/utils/helper.ts`
- 向上遍历：`src/utils/` → `src/` → `/project/`
- 找到 `src/utils/AGENTS.md` 和 `src/AGENTS.md`
- 但**排除** `/project/AGENTS.md`（已在系统提示中）

**场景 2**: 读取 `src/index.ts`
- 向上遍历：`src/` → `/project/`
- 找到 `src/AGENTS.md`
- 排除根目录的

---

## 7. 自动生成机制

### 7.1 内置 init 命令

**文件**: `packages/opencode/src/command/index.ts:63-71`

```typescript
const result: Record<string, Info> = {
  [Default.INIT]: {
    name: Default.INIT,
    description: "create/update AGENTS.md",
    source: "command",
    get template() {
      return PROMPT_INITIALIZE.replace("${path}", Instance.worktree)
    },
    hints: hints(PROMPT_INITIALIZE),
  },
  // ...
}
```

使用方式：
```bash
opencode /init
# 或
/init
```

### 7.2 生成提示模板

**文件**: `packages/opencode/src/command/template/initialize.txt`

```text
Please analyze this codebase and create an AGENTS.md file containing:
1. Build/lint/test commands - especially for running a single test
2. Code style guidelines including imports, formatting, types, naming conventions, error handling, etc.

The file you create will be given to agentic coding agents (such as yourself) that operate in this repository. Make it about 150 lines long.
If there are Cursor rules (in .cursor/rules/ or .cursorrules) or Copilot rules (in .github/copilot-instructions.md), make sure to include them.

If there's already an AGENTS.md, improve it if it's located in ${path}

$ARGUMENTS
```

### 7.3 其他触发场景

**文件**: `packages/opencode/src/server/routes/session.ts:298`

```typescript
"Analyze the current application and create an AGENTS.md file with project-specific agent configurations."
```

### 7.4 主动建议写入

**文件**: `packages/opencode/src/session/prompt/qwen.txt:87`

```
VERY IMPORTANT: When you have completed a task, you MUST run the lint and typecheck commands (e.g. npm run lint, npm run typecheck, ruff, etc.) with Bash if they were provided to you to ensure your code is correct. If you are unable to find the correct command, ask the user for the command to run and if they supply it, proactively suggest writing it to AGENTS.md so that you will know to run it next time.
```

---

## 8. AGENTS.md 内容格式化

**文件**: `packages/opencode/src/session/instruction.ts:system()`

```typescript
export async function system() {
  const paths = await systemPaths()
  
  // 读取所有 AGENTS.md 文件内容
  const files = Array.from(paths).map(async (p) => {
    const content = await Bun.file(p).text().catch(() => "")
    // 格式化：添加文件来源前缀
    return content ? "Instructions from: " + p + "\n" + content : ""
  })

  // 支持 URL 加载的 instructions
  const fetches = urls.map((url) =>
    fetch(url, { signal: AbortSignal.timeout(5000) })
      .then((res) => (res.ok ? res.text() : ""))
      .then((x) => (x ? "Instructions from: " + url + "\n" + x : ""))
  )

  return Promise.all([...files, ...fetches]).then((result) => 
    result.filter(Boolean)  // 过滤空内容
  )
}
```

输出格式示例：
```
Instructions from: /home/user/project/AGENTS.md
# 项目指南
...
```

---

## 9. 配置合并（Config 中的 instructions）

**文件**: `packages/opencode/src/config/config.ts`

```typescript
// 配置合并时，instructions 数组合并并去重
function mergeConfigConcatArrays(target: Info, source: Info): Info {
  const merged = mergeDeep(target, source)
  if (target.instructions && source.instructions) {
    merged.instructions = Array.from(new Set([...target.instructions, ...source.instructions]))
  }
  return merged
}

// Schema 定义
instructions: z.array(z.string()).optional()
  .describe("Additional instruction files or patterns to include")
```

配置加载优先级（从低到高）：
1. Remote `.well-known/opencode`（组织默认值）
2. Global config（`~/.config/opencode/opencode.json{,c}`）
3. Custom config（`OPENCODE_CONFIG`）
4. Project config（`opencode.json{,c}`）
5. `.opencode` 目录
6. Inline config（`OPENCODE_CONFIG_CONTENT`）
7. Managed config（企业部署，最高优先级）

---

## 10. 核心流程图

```
用户发送消息
    │
    ▼
┌─────────────────────────────────┐
│ 构建 System Prompt              │
│                                 │
│ system: [                       │
│   SystemPrompt.environment(),   │
│   InstructionPrompt.system()    │ ← 注入项目根目录 AGENTS.md
│ ]                               │
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│ LLM 调用                        │
└─────────────────────────────────┘
    │
    ▼
使用 read 工具读取文件
    │
    ▼
┌─────────────────────────────────┐
│ InstructionPrompt.resolve()     │
│                                 │
│ 1. 从文件目录向上遍历            │
│ 2. 查找父目录 AGENTS.md          │
│ 3. 排除已在 systemPaths 中的     │
│ 4. 去重检查 (claims/loaded)      │
└─────────────────────────────────┘
    │
    ▼
返回带 <system-reminder> 的内容给 LLM
```

---

## 11. 关键设计思想

1. **分层配置**: 项目级、全局级、用户自定义配置共存
2. **智能去重**: 多层次防止重复加载相同的 instructions
3. **上下文感知**: 根据当前操作文件动态加载相关 instructions
4. **向后兼容**: 支持 AGENTS.md、CLAUDE.md、CONTEXT.md 多种命名
5. **自动化**: 提供 `/init` 命令自动生成/更新 AGENTS.md

---

## 12. 关键文件清单

| 文件路径 | 作用 |
|---------|------|
| `packages/opencode/src/session/instruction.ts` | AGENTS.md 查找、加载、去重核心逻辑 |
| `packages/opencode/src/session/prompt.ts` | 系统提示构建，整合 AGENTS.md |
| `packages/opencode/src/tool/read.ts` | 读取文件时动态加载目录相关的 AGENTS.md |
| `packages/opencode/src/util/filesystem.ts` | 文件系统工具：findUp, globUp |
| `packages/opencode/src/config/config.ts` | 配置合并，支持 instructions 数组 |
| `packages/opencode/src/command/index.ts` | init 命令定义 |
| `packages/opencode/src/command/template/initialize.txt` | AGENTS.md 生成提示模板 |
| `packages/opencode/test/session/instruction.test.ts` | 单元测试 |

---

## 14. AGENTS.md vs SKILL.md 核心区别

### 14.1 本质差异

| 特性 | AGENTS.md | SKILL.md |
|------|-----------|----------|
| **注入位置** | System Prompt（系统提示） | 普通消息（工具输出） |
| **加载方式** | 自动注入（每轮对话） | 按需加载（AI 主动调用 skill 工具） |
| **作用范围** | 全局、长期记忆 | 特定任务、临时上下文 |
| **触发机制** | 被动（自动） | 主动（AI 调用 `skill` 工具） |

### 14.2 AGENTS.md → System Prompt

**文件**: `packages/opencode/src/session/prompt.ts:602`

```typescript
const result = await processor.process({
  system: [
    ...(await SystemPrompt.environment(model)),
    ...(await InstructionPrompt.system()),  // ← AGENTS.md 注入到系统提示
  ],
  messages: [...],
})
```

**特点**:
- **每轮对话自动注入**
- **作为长期记忆**，AI 始终可见
- 影响整个会话的所有回复

### 14.3 SKILL.md → 普通消息（工具输出）

**文件**: `packages/opencode/src/tool/skill.ts:99-120`

```typescript
return {
  title: `Loaded skill: ${skill.name}`,
  output: [
    `<skill_content name="${skill.name}">`,
    `# Skill: ${skill.name}`,
    "",
    skill.content.trim(),  // ← SKILL.md 内容作为工具输出
    "",
    `Base directory for this skill: ${base}`,
    "</skill_content>",
  ].join("\n"),
  metadata: {
    name: skill.name,
    dir,
  },
}
```

**特点**:
- **按需加载**：AI 必须主动调用 `skill` 工具（`skill({"name": "xxx"})`）
- **普通消息**：作为工具执行结果附加到对话中，不是 System Prompt
- **上下文感知**：可以附带技能目录下的其他资源文件

### 14.4 使用流程对比

#### AGENTS.md（被动式）
```
每轮 LLM 调用
    ↓
自动注入到 System Prompt
    ↓
AI 始终可见（全局上下文）
```

#### SKILL.md（主动式）
```
AI 识别任务需要特定技能
    ↓
调用 skill({"name": "数据库设计评审"})
    ↓
返回 <skill_content> 作为工具输出
    ↓
AI 在当前轮次使用该技能（临时上下文）
```

### 14.5 Skill 的发现机制

**文件**: `packages/opencode/src/skill/skill.ts:46-52`

```typescript
const EXTERNAL_SKILL_GLOB = new Bun.Glob("skills/**/SKILL.md")  // .claude/skills/
const OPENCODE_SKILL_GLOB = new Bun.Glob("{skill,skills}/**/SKILL.md")  // .opencode/skill/

export const state = Instance.state(async () => {
  const skills: Record<string, Info> = {}
  
  // 1. 扫描外部技能目录 (.claude/skills/, .agents/skills/)
  // 2. 扫描 .opencode/skill/ 目录
  // 3. 扫描配置中指定的 skills.paths
})
```

**Skill 扫描路径**（按优先级）：
1. `~/.claude/skills/**/SKILL.md`
2. `~/.agents/skills/**/SKILL.md`
3. `.opencode/skill/**/SKILL.md`
4. 配置中指定的 `config.skills.paths`

### 14.6 设计哲学

**AGENTS.md**：
- **全局约定**：适用于整个项目的通用规则
- **长期记忆**：一旦加载，始终伴随对话
- **被动加载**：无需 AI 干预，自动生效

**SKILL.md**：
- **专业领域**：针对特定任务的详细工作流
- **按需加载**：仅在需要时引入，避免污染上下文
- **主动调用**：AI 根据任务判断是否需要加载

**为什么这样设计？**

```
AGENTS.md = 项目通用知识（始终需要）
SKILL.md  = 专业知识库（按需取用）

这样既保证了全局一致性，又避免了每轮对话都携带
大量不相关的专业指令，实现了上下文的高效管理。
```

---

## 15. 参考资源

- 事务: #1042 (TongAgents平台迭代升级)
- 研究时间: 2026-02-06
- 代码版本: thirdparty/opencode (commit: 当前工作目录)
