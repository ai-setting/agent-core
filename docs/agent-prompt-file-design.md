# Agent Prompt 配置文件设计文档

## 1. 需求背景

当前 agent-core 中 agent 的 prompt 存在以下问题：

1. **存储方式**：agent 的 prompt 存储在代码内存中（`BaseEnvironment.prompts: Map<string, Prompt>`），需要通过 `addPrompt()` 手动注入
2. **配置引用**：在 `agents.jsonc` 中通过 `promptId` 引用，但实际的 prompt 内容不在配置文件中
3. **维护性差**：修改 prompt 需要修改代码或重新部署

参考 taskTool 中从 `task.txt` 加载 description 的方式（`packages/core/src/core/environment/expend/task/task-tool.ts:12-17`），以及 opencode 项目中 agent prompt 的存储方式（`.opencode/agent/*.md`，使用 frontmatter 存储元数据），设计一套从配置文件加载 agent prompt 的方案。

## 2. 设计目标

1. **文件化**：将 agent 的 prompt 内容存储在独立的 `.prompt` 文件中
2. **可引用**：在 `agents.jsonc` 中通过 `promptId`（即文件名）引用对应的 prompt 文件
3. **可扩展**：支持模板变量替换（如 `{tool_list}`、`{agent_capabilities}` 等）
4. **一致性**：与现有配置系统（ConfigSource、Environment）保持一致

## 3. 目录结构

### 3.1 环境配置目录

```
~/.config/tong_work/agent-core/
├── tong_work.jsonc                 # 主配置文件
└── environments/
    └── {env-name}/
        ├── config.jsonc            # Environment 运行时配置
        ├── agents.jsonc            # Agent 配置（引用 promptId）
        ├── models.jsonc            # 模型配置
        └── prompts/                # Prompt 文件目录（新增）
            ├── system.prompt       # 系统级 prompt
            ├── coding.prompt       # Coding agent prompt
            ├── review.prompt       # Review agent prompt
            └── subagent/
                ├── general.prompt  # 通用子 agent prompt
                └── explore.prompt  # 探索子 agent prompt
```

### 3.2 内置 Prompt 目录（可选）

对于内置的 environment（如 `os_env`），可以在代码包中内置默认 prompt：

```
packages/core/src/core/environment/expend/os/
├── prompts/                       # 内置 prompt 目录
│   ├── system.prompt
│   ├── coding.prompt
│   └── ...
```

## 4. 文件格式

### 4.1 Prompt 文件格式（.prompt）

采用类似 opencode 的 frontmatter 格式，支持元数据和内容分离：

```markdown
---
id: system
description: Default system prompt for all agents
variables:
  - tool_list
  - agent_capabilities
---

You are an AI assistant powered by OpenCode.

## Available Tools
{tool_list}

## Agent Capabilities
{agent_capabilities}

## Guidelines
- Always prioritize user privacy and security
- Provide clear, concise responses
```

### 4.2 Frontmatter 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | Prompt 唯一标识，与 `promptId` 对应 |
| `description` | string | 否 | Prompt 描述，用于文档和调试 |
| `variables` | string[] | 否 | 模板变量列表，用于验证和文档 |
| `role` | string | 否 | prompt 角色（system/user/assistant） |
| `version` | string | 否 | 版本号，用于版本管理 |

### 4.3 模板变量

支持在 prompt 内容中使用变量占位符：

| 变量 | 说明 | 示例 |
|------|------|------|
| `{tool_list}` | 可用工具列表 | 由环境自动注入 |
| `{agent_capabilities}` | Agent 能力描述 | 由环境自动注入 |
| `{env_name}` | 环境名称 | os_env, web_env |
| `{agent_id}` | Agent ID | coding-assistant |
| `{role}` | Agent 角色 | primary, sub |

## 5. Agent 配置更新

### 5.1 agents.jsonc 引用方式

```jsonc
{
  "agents": [
    {
      "id": "coding-assistant",
      "role": "primary",
      "promptId": "coding",
      "allowedTools": ["bash", "read", "write", "glob", },
    {
      "id": "reviewer",
      "role": " "grep"]
   sub",
      "promptId": "review",
      "allowedTools": ["read", "glob"]
    }
  ]
}
```

### 5.2 支持 promptOverride

如果需要临时覆盖 prompt 文件内容，可以在配置中直接指定：

```jsonc
{
  "agents": [
    {
      "id": "custom-agent",
      "role": "primary",
      "promptId": "coding",
      "promptOverride": "You are a custom coding assistant...",
      "allowedTools": ["read", "write"]
    }
  ]
}
```

## 6. 加载机制实现

### 6.1 新增模块

```
packages/core/src/config/
├── sources/
│   ├── prompt.ts          # 新增：Prompt 文件加载器
│   └── environment.ts     # 现有：Environment 配置加载
├── prompts/
│   ├── loader.ts          # 新增：Prompt 加载核心逻辑
│   ├── variables.ts       # 新增：模板变量处理
│   └── types.ts           # 新增：Prompt 相关类型
```

### 6.2 核心类型定义

```typescript
// config/prompts/types.ts
export interface PromptMetadata {
  id: string;
  description?: string;
  variables?: string[];
  role?: "system" | "user" | "assistant";
  version?: string;
}

export interface PromptFile {
  metadata: PromptMetadata;
  content: string;
}

export interface ResolvedPrompt {
  id: string;
  content: string;
  role: "system" | "user" | "assistant";
  metadata: PromptMetadata;
}
```

### 6.3 加载流程

```typescript
// config/prompts/loader.ts
export class PromptLoader {
  constructor(private envName: string, private basePath?: string) {}

  async loadPrompt(promptId: string): Promise<PromptFile | null> {
    // 1. 首先从环境配置目录加载
    const envPrompt = await this.loadFromEnvironment(promptId);
    if (envPrompt) return envPrompt;

    // 2. 然后从内置目录加载（可选）
    const builtInPrompt = await this.loadBuiltIn(promptId);
    if (builtInPrompt) return builtInPrompt;

    return null;
  }

  async loadAllPrompts(): Promise<Map<string, PromptFile>> {
    const prompts = new Map<string, PromptFile>();
    // 加载环境目录下的所有 .prompt 文件
    // ...
    return prompts;
  }

  resolveVariables(content: string, context: PromptContext): string {
    // 替换模板变量
    return content
      .replace(/{tool_list}/g, context.toolList)
      .replace(/{agent_capabilities}/g, context.capabilities)
      .replace(/{env_name}/g, context.envName)
      .replace(/{agent_id}/g, context.agentId)
      .replace(/{role}/g, context.role);
  }
}
```

### 6.4 与 Environment 集成

修改 `BaseEnvironment`，添加从配置文件加载 prompt 的能力：

```typescript
// core/environment/base/base-environment.ts
export abstract class BaseEnvironment implements Environment {
  protected prompts: Map<string, Prompt> = new Map();
  protected promptLoader: PromptLoader | null = null;

  async initialize(): Promise<void> {
    // 现有初始化逻辑...
    
    // 加载 prompt 文件
    await this.loadPromptsFromConfig();
  }

  protected async loadPromptsFromConfig(): Promise<void> {
    const envName = this.getEnvironmentName();
    if (!envName) return;

    const loader = new PromptLoader(envName);
    const loadedPrompts = await loader.loadAllPrompts();

    for (const [id, promptFile] of loadedPrompts) {
      const context = {
        toolList: this.getToolsDescription(),
        capabilities: this.getCapabilitiesDescription(),
        envName,
        agentId: id,
        role: "system",
      };
      
      const resolvedContent = loader.resolveVariables(promptFile.content, context);
      
      this.prompts.set(id, {
        id,
        content: resolvedContent,
        metadata: promptFile.metadata,
      });
    }
  }

  getPrompt(promptId: string): Prompt | undefined {
    return this.prompts.get(promptId);
  }
}
```

## 7. 现有代码整合

### 7.1 ConfigSource 扩展

在 Environment 配置加载时，自动发现并加载 prompts 目录：

```typescript
// config/sources/environment.ts
export async function loadEnvironmentConfig(
  envName: string,
  basePath?: string
): Promise<Config.Info | null> {
  // ... 现有逻辑 ...

  // 加载 Prompts（新增）
  const promptsPath = path.join(envDir, "prompts");
  try {
    const promptFiles = await fs.readdir(promptsPath);
    const promptIds = promptFiles
      .filter(f => f.endsWith(".prompt"))
      .map(f => f.replace(".prompt", ""));
    
    // 将 promptIds 记录到配置中，供 Environment 初始化时使用
    config.promptIds = promptIds;
  } catch {
    // prompts 目录可选
  }

  return config;
}
```

### 7.2 agents.jsonc 解析兼容

保持现有 `agents.jsonc` 格式不变，`promptId` 字段：

- 如果是文件路径（如 `prompts/coding.prompt`），提取文件名作为 ID
- 如果是简单字符串（如 `coding`），直接作为 ID

## 8. 示例

### 8.1 默认 system.prompt（参考 opencode build agent）

基于 opencode 的 build agent prompt 设计，作为 agent-core 的默认 system prompt：

**文件**：`environments/os_env/prompts/system.prompt`

```markdown
---
id: system
description: Default system prompt for agent-core agents
variables:
  - tool_list
  - env_name
  - env_info
---

You are TongWork Agent, an AI assistant that helps users with software engineering tasks.

## Your Role
- You are an autonomous agent that executes tasks based on user instructions
- Use the available tools to complete tasks without asking unnecessary questions
- Always prioritize user privacy and security

## Tool Usage
- Use specialized tools instead of shell commands when possible:
  - Use Read tool to view files
  - Use Edit tool to modify files
  - Use Write tool only when creating new files is absolutely necessary
  - Use Glob to find files by name and Grep to search file contents
  - Use Bash for terminal operations (git, builds, tests, running scripts)
- Run tool calls in parallel when neither call needs the other's output

## Available Tools
{tool_list}

## Environment
{env_info}

## Task Management
Use TodoWrite tool to manage and plan tasks:
- Break down complex tasks into smaller steps
- Track progress with clear status (pending/in_progress/completed)
- Mark tasks as completed immediately after finishing

## Code Style
- Write clean, maintainable code
- Add comments only when necessary to explain non-obvious logic
- Follow existing code conventions in the project

## Best Practices
- Prefer ASCII characters when editing files
- Use apply_patch for single file edits when possible
- When exploring codebases for context, use Task tool with specialized agents

## Communication
- Be concise and friendly
- Do the work without asking questions unless truly blocked
- If you must ask: do all non-blocked work first, then ask one targeted question
- Never ask permission questions like "Should I proceed?"; proceed with reasonable defaults

## Final Answer Structure
- Lead with a quick explanation, then give context
- Use **bold** for short titles (1-3 words)
- Use - for bullets
- Use `code` for file paths, commands, and inline code examples
- Reference files with paths like `src/app.ts:42`
- Suggest logical next steps (tests, commits) at the end when appropriate
```

### 8.2 subagent general.prompt

```markdown
---
id: general
description: General-purpose subagent prompt
role: sub
variables:
  - tool_list
  - task_description
---

You are a sub-agent created by the main agent to handle a specific task.

## Task
{task_description}

## Guidelines
- Complete the task autonomously without involving the user
- Return results clearly to the main agent
- Do not use TodoWrite or TodoRead tools
- Do not spawn other subagents

## Available Tools
{tool_list}
```

### 8.3 示例：os_env 配置

**文件**：`~/.config/tong_work/agent-core/environments/os_env/agents.jsonc`

```jsonc
{
  "agents": [
    {
      "id": "default",
      "role": "primary",
      "promptId": "system",
      "allowedTools": ["*"]
    },
    {
      "id": "coding-assistant",
      "role": "primary",
      "promptId": "system",
      "allowedTools": ["bash", "read", "write", "glob", "grep", "edit"]
    },
    {
      "id": "reviewer",
      "role": "sub",
      "promptId": "general",
      "allowedTools": ["read", "glob"]
    }
  ]
}
```

**文件**：`~/.config/tong_work/agent-core/environments/os_env/prompts/system.prompt`

```markdown
---
id: system
description: Default system prompt for OS environment
variables:
  - tool_list
  - env_name
---

You are an AI assistant running in the {env_name} environment.

## Available Tools
{tool_list}

## Guidelines
- Always prioritize user privacy and security
- Provide clear, concise responses
- Use bash tools for system operations
```

## 9. 迁移指南

### 9.1 现有代码迁移

1. **移除硬编码 prompt**：将代码中的 `addPrompt()` 调用迁移到 `.prompt` 文件
2. **更新 agents.jsonc**：添加 `promptId` 字段引用对应的 prompt 文件
3. **测试验证**：确保加载的 prompt 内容正确

### 9.2 向后兼容

- 如果 `promptId` 指定的文件不存在，回退到原有的 `promptOverride` 或内存中的 prompt
- 保持 `BaseEnvironment.addPrompt()` 方法可用，用于动态添加 prompt

## 10. 实现计划

1. **Phase 1**：创建 prompt 加载核心模块（`config/prompts/`）
2. **Phase 2**：更新 `BaseEnvironment` 集成 prompt 加载
3. **Phase 3**：更新配置加载逻辑，发现 prompts 目录
4. **Phase 4**：添加模板变量解析
5. **Phase 5**：测试和文档

## 11. 参考资料

- taskTool description 加载方式：`packages/core/src/core/environment/expend/task/task-tool.ts:12-17`
- opencode agent 存储方式：`.opencode/agent/*.md`
- 现有配置系统：`docs/config-design.md`
