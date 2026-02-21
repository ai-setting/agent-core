# System Prompt 注入机制设计文档

## 一、设计目标

借鉴 OpenCode 和 OpenClaw 的 AGENTS.md 注入机制，但采用更简洁的实现方式：

1. **以 Environment 为中心**：行为约束由 Environment 统一管理，符合现有设计理念
2. **分层叠加**：Environment rules（环境级共享）+ Agent prompt（agent 特定）
3. **实时更新**：Agent 每次 query 时从 Environment 获取最新行为规范
4. **极简配置**：一个环境对应一个 `rules.md`，不需要复杂的文件优先级和动态加载
5. **模型能力适配**：随着模型能力提升，只需切换不同的 Environment 即可获得不同的行为约束

## 二、核心设计

### 2.1 分层叠加理念

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        分层叠加设计                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    Environment 层（共享）                        │   │
│   │  config/environments/{envName}/rules.md                         │   │
│   │  - 所有 agent 共享的行为规范                                     │   │
│   │  - 环境级约束、安全策略、通用指导                                │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                              +                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    Agent 层（特定）                              │   │
│   │  config/environments/{envName}/prompts/{agentId}.prompt         │   │
│   │  - agent 特定的角色定义                                         │   │
│   │  - 任务指导、工具权限、专业领域                                  │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                              =                                          │
│   ┌─────────────────────────────────────────────────────────────────┐   │
│   │                    最终 System Prompt                           │   │
│   │  env.getBehaviorSpec(agentId) → 组合后的完整行为规范            │   │
│   └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 与现有 AgentSpec 的融合

现有的 `EnvironmentAgentSpec` 已经定义了 agent 的配置：

```typescript
interface EnvironmentAgentSpec {
  id: string;                    // agent 标识
  role: "primary" | "sub";       // 角色
  promptId?: string;             // 引用 env 内部的 prompt
  promptOverride?: string;       // 或直接覆盖 prompt
  allowedTools?: string[];       // 工具白名单
  deniedTools?: string[];        // 工具黑名单
}
```

本设计将：
- **Environment rules**：作为环境级共享的行为规范基础
- **Agent prompt**：通过 `promptId` 或 `promptOverride` 指定
- **组合逻辑**：`getBehaviorSpec(agentId)` 返回叠加后的完整规范

### 2.3 与 OpenCode/OpenClaw 的对比

| 特性 | OpenCode | OpenClaw | agent-core（本设计） |
|------|----------|----------|---------------------|
| 核心载体 | instruction.ts 加载文件 | workspace.ts 加载多文件 | Environment + AgentSpec |
| 注入时机 | 会话初始化 + Read tool 动态 | 会话初始化时 | 每次 query 时 |
| 文件数量 | 3 种优先级 + 全局 + 远程 | 8 种文件 | 1 个 rules.md + N 个 agent prompt |
| 动态更新 | 复杂（claims 去重） | 不支持 | 简单（Environment 切换） |
| 分层设计 | 无 | 无 | **Environment + Agent 双层** |
| 复杂度 | 高 | 中 | **低** |

### 2.3 行为规范来源

```
配置目录结构：
config/
└── environments/
    ├── default/
    │   ├── rules.md              # 环境级行为规范（所有 agent 共享）
    │   ├── prompts/
    │   │   ├── system.prompt     # 默认/主 agent 的 prompt
    │   │   ├── coder.prompt      # 编码 agent 的特定 prompt
    │   │   └── analyst.prompt    # 分析 agent 的特定 prompt
    │   └── skills/
    ├── coding/
    │   ├── rules.md              # 编码环境的行为规范
    │   └── prompts/
    │       └── system.prompt
    └── analysis/
        ├── rules.md              # 分析环境的行为规范
        └── prompts/
            └── system.prompt
```

### 2.4 System Prompt 组合示例

**Environment rules.md（共享）**：
```markdown
# Environment Behavior Guidelines

## Safety Rules
- Never expose API keys or secrets
- Always validate user inputs before processing
- Ask for confirmation before destructive operations

## Communication Style
- Be concise and clear
- Explain reasoning before taking action
- Summarize changes after completion
```

**Agent prompt (coder.prompt)**：
```markdown
---
id: coder
role: system
description: Coding assistant prompt
---

# Coding Assistant

You are a coding assistant specialized in TypeScript/JavaScript development.

## Code Guidelines
- Use TypeScript for all new code
- Follow existing code conventions
- Add appropriate error handling
- Write tests for new functionality

## Tool Preferences
- Use `grep` for code search
- Use `glob` for file discovery
- Read files before modifying
```

**最终 System Prompt（组合后）**：
```
# Environment: coding
Working directory: /path/to/project

# Environment Behavior Guidelines

## Safety Rules
- Never expose API keys or secrets
- Always validate user inputs before processing
- Ask for confirmation before destructive operations

## Communication Style
- Be concise and clear
- Explain reasoning before taking action
- Summarize changes after completion

---

# Agent: coder

# Coding Assistant

You are a coding assistant specialized in TypeScript/JavaScript development.

## Code Guidelines
- Use TypeScript for all new code
- Follow existing code conventions
- Add appropriate error handling
- Write tests for new functionality

## Tool Preferences
- Use `grep` for code search
- Use `glob` for file discovery
- Read files before modifying
```

> **注意**：工具列表不包含在 system prompt 中，而是通过 LLM API 的 `tools` 参数传递。

## 三、接口设计

### 3.1 Environment 接口扩展

```typescript
// packages/core/src/core/environment/index.ts

/**
 * 行为规范（完整）
 * 包含环境级规则 + agent 特定 prompt 的组合
 */
export interface BehaviorSpec {
  /** 环境名称 */
  envName: string;
  /** Agent ID */
  agentId: string;
  /** Agent 角色 */
  agentRole: "primary" | "sub";
  
  /** 环境级规则（所有 agent 共享） */
  envRules: string;
  /** Agent 特定 prompt（来自 promptId 或 promptOverride） */
  agentPrompt: string;
  
  /** 组合后的完整 system prompt */
  combinedPrompt: string;
  
  /** 工具权限（用于过滤传给 LLM 的 tools 参数） */
  allowedTools?: string[];
  deniedTools?: string[];
  
  /** 元数据 */
  metadata?: {
    lastUpdated?: string;
    version?: string;
  };
}

export interface Environment {
  // ... 现有接口 ...
  
  /**
   * 获取指定 agent 的完整行为规范
   * 组合：环境级规则 + agent 特定 prompt
   * 
   * @param agentId - agent 标识，默认为 "default" 或 "system"
   */
  getBehaviorSpec(agentId?: string): BehaviorSpec | Promise<BehaviorSpec>;
  
  /**
   * 刷新行为规范（从文件重新加载）
   */
  refreshBehaviorSpec?(): void | Promise<void>;
  
  /**
   * 获取环境级规则（所有 agent 共享）
   */
  getEnvRules(): string | Promise<string>;
}
```

> **设计说明**：
> - 工具通过 `env.getTools()` 获取，在 LLM 调用时作为 `tools` 参数传递
> - `allowedTools` / `deniedTools` 用于过滤 `getTools()` 返回的工具列表
> - 不在 system prompt 中描述工具，避免与 LLM API 的 tools 参数重复
```

### 3.2 BaseEnvironment 实现

```typescript
// packages/core/src/core/environment/base/base-environment.ts

export abstract class BaseEnvironment implements Environment {
  protected envRules: string | null = null;
  protected agentPrompts: Map<string, string> = new Map();
  protected agentSpecs: Map<string, EnvironmentAgentSpec> = new Map();
  protected envName: string = "default";
  
  /**
   * 获取完整行为规范（组合 env rules + agent prompt）
   */
  async getBehaviorSpec(agentId: string = "system"): Promise<BehaviorSpec> {
    if (this.envRules === null) {
      await this.loadBehaviorSpec();
    }
    
    const agentSpec = this.agentSpecs.get(agentId);
    const agentPrompt = this.agentPrompts.get(agentId) || "";
    
    const combinedPrompt = this.combinePrompts(
      this.envRules || "",
      agentPrompt,
      agentId
    );
    
    return {
      envName: this.envName,
      agentId,
      agentRole: agentSpec?.role || "primary",
      envRules: this.envRules || "",
      agentPrompt,
      combinedPrompt,
      allowedTools: agentSpec?.allowedTools,
      deniedTools: agentSpec?.deniedTools,
      metadata: {
        lastUpdated: new Date().toISOString(),
      },
    };
  }
  
  /**
   * 获取环境级规则
   */
  async getEnvRules(): Promise<string> {
    if (this.envRules === null) {
      await this.loadBehaviorSpec();
    }
    return this.envRules || "";
  }
  
  /**
   * 刷新行为规范
   */
  async refreshBehaviorSpec(): Promise<void> {
    this.envRules = null;
    this.agentPrompts.clear();
    await this.loadBehaviorSpec();
  }
  
  /**
   * 加载行为规范
   */
  protected async loadBehaviorSpec(): Promise<void> {
    await this.loadEnvRules();
    await this.loadAgentPrompts();
    await this.loadAgentSpecs();
  }
  
  /**
   * 加载环境级规则（rules.md）
   */
  protected async loadEnvRules(): Promise<void> {
    const rulesPath = this.getRulesFilePath();
    
    if (!rulesPath) {
      this.envRules = this.getDefaultEnvRules();
      return;
    }
    
    try {
      this.envRules = await fs.readFile(rulesPath, "utf-8");
    } catch {
      this.envRules = this.getDefaultEnvRules();
    }
  }
  
  /**
   * 加载 agent prompts
   */
  protected async loadAgentPrompts(): Promise<void> {
    const promptsDir = this.getPromptsDirectory();
    if (!promptsDir) return;
    
    try {
      const { loadPromptsFromEnvironment } = await import("../../../config/prompts/loader.js");
      const prompts = await loadPromptsFromEnvironment(this.envName, promptsDir);
      
      for (const prompt of prompts) {
        this.agentPrompts.set(prompt.id, prompt.content);
      }
    } catch {
      // prompts 目录不存在
    }
  }
  
  /**
   * 加载 agent specs（从 profile 配置）
   */
  protected async loadAgentSpecs(): Promise<void> {
    const profiles = await this.getProfiles?.() || [];
    const profile = profiles[0];
    
    if (profile) {
      for (const agent of profile.primaryAgents) {
        this.agentSpecs.set(agent.id, agent);
        
        if (agent.promptOverride) {
          this.agentPrompts.set(agent.id, agent.promptOverride);
        }
      }
      
      for (const agent of profile.subAgents || []) {
        this.agentSpecs.set(agent.id, agent);
        
        if (agent.promptOverride) {
          this.agentPrompts.set(agent.id, agent.promptOverride);
        }
      }
    }
  }
  
  /**
   * 组合 prompt（环境规则 + agent prompt）
   */
  protected combinePrompts(
    envRules: string,
    agentPrompt: string,
    agentId: string
  ): string {
    const parts: string[] = [];
    
    // 1. 环境信息头
    parts.push(`# Environment: ${this.envName}`);
    parts.push(`# Agent: ${agentId}`);
    parts.push(`Working directory: ${process.cwd()}`);
    parts.push(`Today: ${new Date().toISOString().split('T')[0]}`);
    parts.push("");
    
    // 2. 环境级规则
    if (envRules) {
      parts.push("---");
      parts.push("# Environment Behavior Guidelines");
      parts.push("");
      parts.push(envRules);
      parts.push("");
    }
    
    // 3. Agent 特定 prompt
    if (agentPrompt) {
      parts.push("---");
      parts.push(`# Agent: ${agentId}`);
      parts.push("");
      parts.push(agentPrompt);
    }
    
    return parts.join("\n");
  }
  
  /**
   * 根据权限过滤工具列表
   * 用于在 LLM 调用时过滤 tools 参数
   */
  filterToolsByPermission(
    tools: Tool[],
    agentSpec?: EnvironmentAgentSpec
  ): Tool[] {
    let filtered = tools;
    
    if (agentSpec?.allowedTools) {
      const allowed = new Set(agentSpec.allowedTools);
      filtered = filtered.filter(t => allowed.has(t.name));
    }
    
    if (agentSpec?.deniedTools) {
      const denied = new Set(agentSpec.deniedTools);
      filtered = filtered.filter(t => !denied.has(t.name));
    }
    
    return filtered;
  }
  
  /**
   * 默认环境规则
   */
  protected getDefaultEnvRules(): string {
    return [
      "# Default Environment Guidelines",
      "",
      "## Safety",
      "- Do not expose sensitive information",
      "- Validate inputs before processing",
      "- Ask for confirmation on destructive operations",
      "",
      "## Communication",
      "- Be helpful and accurate",
      "- Explain your reasoning",
      "- Summarize after completing tasks",
    ].join("\n");
  }
  
  // 抽象方法
  protected abstract getRulesFilePath(): string | undefined;
  protected abstract getPromptsDirectory(): string | undefined;
  protected abstract getEnvName(): string;
}
```

### 3.3 Agent 改造

```typescript
// packages/core/src/core/agent/index.ts

export interface AgentConfig {
  maxIterations?: number;
  maxErrorRetries?: number;
  retryDelayMs?: number;
  retryBackoffFactor?: number;
  maxRetryDelayMs?: number;
  doomLoopThreshold?: number;
  /** Agent ID（用于获取特定的行为规范） */
  agentId?: string;
}

export class Agent {
  private config: Required<AgentConfig>;
  private agentId: string;
  
  constructor(
    private event: Event,
    private env: Environment,
    tools: import("../types").Tool[],
    private context: Context = {},
    configOverrides: AgentConfig = {},
    history?: HistoryMessage[],
  ) {
    this.config = { ...DEFAULT_CONFIG, ...configOverrides };
    this.agentId = configOverrides.agentId || "system";
    this._history = history ?? [];
    this.tools = tools;
  }
  
  async run(): Promise<string> {
    this.iteration = 0;
    this.doomLoopCache.clear();
    this.aborted = false;

    // 从 Environment 获取该 agent 的行为规范
    const behaviorSpec = await this.env.getBehaviorSpec(this.agentId);
    const systemPrompt = behaviorSpec.combinedPrompt;

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      ...this._history.map(h => ({
        role: h.role as Message["role"],
        content: convertContent(h.content),
        name: h.name,
      })),
      { role: "user", content: this.formatEvent(this.event) },
    ];

    // 工具已通过 env.getTools() 获取，并已根据 allowedTools/deniedTools 过滤
    // 在 invokeLLM 时会作为 tools 参数传递给 LLM API

    // ... 其余逻辑不变 ...
  }
  
  // ... 其余方法不变 ...
}

/**
 * 创建 Agent 的工厂函数
 */
export function createAgent(
  event: Event,
  env: Environment,
  tools: import("../types").Tool[],
  context: Context,
  config?: AgentConfig,
  history?: HistoryMessage[],
): Agent {
  return new Agent(event, env, tools, context, config, history);
}
```

> **工具传递流程**：
> 1. `env.getTools()` 获取所有注册的工具
> 2. `env.filterToolsByPermission(tools, agentSpec)` 根据权限过滤
> 3. 过滤后的工具作为 `tools` 参数传递给 `invokeLLM()`

### 3.4 ServerEnvironment 实现

```typescript
// packages/core/src/server/environment.ts

export class ServerEnvironment extends BaseEnvironment {
  private rulesDirectory: string | undefined;
  private promptsDirectory: string | undefined;
  
  protected getRulesFilePath(): string | undefined {
    if (!this.rulesDirectory) return undefined;
    return path.join(this.rulesDirectory, "rules.md");
  }
  
  protected getPromptsDirectory(): string | undefined {
    return this.promptsDirectory;
  }
  
  protected getEnvName(): string {
    return this.envName;
  }
  
  /**
   * 切换环境时自动更新行为规范
   */
  async switchEnvironment(envName: string, context?: Context): Promise<boolean> {
    // ... 现有逻辑 ...
    
    // 更新环境名称和目录
    this.envName = envName;
    this.rulesDirectory = path.join(ConfigPaths.environments, envName);
    this.promptsDirectory = path.join(ConfigPaths.environments, envName, "prompts");
    
    // ⭐ 刷新行为规范（包括 env rules + agent prompts）
    await this.refreshBehaviorSpec();
    
    // ... 其余逻辑 ...
  }
  
  /**
   * 加载配置时设置行为规范
   */
  async loadFromConfig(): Promise<void> {
    // ... 现有逻辑 ...
    
    if (config.activeEnvironment) {
      this.envName = config.activeEnvironment;
      this.rulesDirectory = path.join(ConfigPaths.environments, config.activeEnvironment);
      this.promptsDirectory = path.join(ConfigPaths.environments, config.activeEnvironment, "prompts");
      
      // 加载行为规范（env rules + agent prompts）
      await this.loadBehaviorSpec();
    }
  }
}
```

## 四、使用示例

### 4.1 文件结构示例

```
config/environments/coding/
├── rules.md              # 环境级规则（所有 agent 共享）
└── prompts/
    ├── system.prompt     # 主 agent prompt
    └── reviewer.prompt   # 代码审查 agent prompt
```

### 4.2 Environment rules.md 示例

```markdown
# Environment Behavior Guidelines

## Safety Rules
- Never expose API keys, passwords, or secrets
- Always validate user inputs before processing
- Ask for confirmation before destructive operations (file deletion, system commands)

## Communication Style
- Be concise and clear in your responses
- Explain your reasoning before taking action
- Summarize what you've done after completing a task
- Ask for clarification when requirements are ambiguous

## Project Context
- Follow existing code style and conventions
- Prefer TypeScript for new code
- Add appropriate error handling
- Write tests for new functionality
```

### 4.3 Agent prompt 示例

**system.prompt（主 agent）**：
```markdown
---
id: system
role: system
description: Primary coding assistant
---

# Coding Assistant

You are a coding assistant helping with software development tasks.

## Capabilities
- Read and write files
- Execute shell commands
- Search code patterns
- Manage project structure

## Approach
1. Understand the task thoroughly
2. Explore relevant code first
3. Plan your changes
4. Implement with clear commit-worthy steps
5. Verify and test your changes
```

**reviewer.prompt（子 agent）**：
```markdown
---
id: reviewer
role: system
description: Code review specialist
allowedTools:
  - read
  - grep
  - glob
---

# Code Reviewer

You are a code review specialist. Your job is to analyze code and provide feedback.

## Focus Areas
- Code quality and readability
- Potential bugs and edge cases
- Performance considerations
- Security vulnerabilities

## Constraints
- You can only READ files, not modify them
- Provide actionable feedback with specific line references
- Prioritize issues by severity (critical, major, minor)
```

### 4.4 API 调用示例

```typescript
// 创建环境
const env = new ServerEnvironment({ loadConfig: true });
await env.waitForReady();

// 获取环境级规则（所有 agent 共享）
const envRules = await env.getEnvRules();
console.log("Environment rules:", envRules);

// 获取主 agent 的完整行为规范
const mainSpec = await env.getBehaviorSpec("system");
console.log("Main agent prompt:", mainSpec.combinedPrompt);

// 获取审查 agent 的行为规范（包含工具限制）
const reviewerSpec = await env.getBehaviorSpec("reviewer");
console.log("Reviewer allowed tools:", reviewerSpec.allowedTools);

// 使用 Agent（自动获取对应的行为规范）
const agent = new Agent(event, env, tools, context, {
  agentId: "reviewer",  // 指定 agent ID
});
const result = await agent.run();

// 切换环境（行为规范自动更新）
await env.switchEnvironment("analysis");
const analysisSpec = await env.getBehaviorSpec("system");
```

### 4.5 动态刷新

```typescript
// 监听 rules.md 文件变化
fs.watch(rulesPath, async (eventType) => {
  if (eventType === 'change') {
    console.log('[Environment] rules.md changed, refreshing...');
    await env.refreshBehaviorSpec();
    
    // 下一次 query 会使用更新后的规则
  }
});
```

## 五、实现步骤

### Phase 1: 核心接口和基础实现

1. **扩展 Environment 接口**
   - 文件：`packages/core/src/core/environment/index.ts`
   - 添加 `BehaviorSpec` 类型定义（包含 envRules + agentPrompt）
   - 添加 `getBehaviorSpec(agentId?)` 方法
   - 添加 `getEnvRules()` 方法

2. **实现 BaseEnvironment 行为规范加载**
   - 文件：`packages/core/src/core/environment/base/base-environment.ts`
   - 实现 `loadEnvRules()` 加载环境级规则
   - 实现 `loadAgentPrompts()` 加载 agent prompts
   - 实现 `combinePrompts()` 组合逻辑
   - 实现工具权限过滤

3. **改造 Agent**
   - 文件：`packages/core/src/core/agent/index.ts`
   - 添加 `agentId` 配置项
   - 在 `run()` 方法中调用 `env.getBehaviorSpec(agentId)`
   - 实现 `filterToolsByPermission()` 工具权限过滤

### Phase 2: ServerEnvironment 集成

1. **实现 ServerEnvironment 行为规范管理**
   - 文件：`packages/core/src/server/environment.ts`
   - 实现 `getRulesFilePath()` 和 `getPromptsDirectory()`
   - 在 `loadFromConfig()` 中加载行为规范
   - 在 `switchEnvironment()` 中刷新行为规范

2. **创建默认配置文件**
   - 文件：`config/environments/default/rules.md`
   - 文件：`config/environments/default/prompts/system.prompt`

### Phase 3: 与现有 Profile/AgentSpec 融合

1. **更新 getProfiles() 方法**
   - 确保 `getProfiles()` 返回的 `EnvironmentAgentSpec` 正确映射到 agent prompts
   - 支持 `promptOverride` 直接覆盖

2. **更新 handle_query() 方法**
   - 使用 `getBehaviorSpec("system")` 获取主 agent 的行为规范
   - 支持根据 context.agentId 获取不同 agent 的规范

## 六、与现有代码的兼容性

### 6.1 现有 prompt 加载机制的融合

| 机制 | 用途 | 本设计处理方式 |
|------|------|---------------|
| `prompts/*.prompt` | Agent 特定 prompt | **保留**，作为 agent prompt 的来源 |
| `loadPromptsFromEnvironment()` | 加载 prompt 文件 | **保留**，在 `loadAgentPrompts()` 中调用 |
| `getProfiles()` | Agent 配置（权限、promptId） | **保留**，用于加载 agentSpecs |
| **新增** `rules.md` | 环境级共享规则 | **新增**，作为 envRules 的来源 |

### 6.2 数据流

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          数据流                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  rules.md ──────────────────────────────────────┐                       │
│                                                  ▼                       │
│                                          ┌──────────────┐               │
│                                          │  envRules    │               │
│                                          └──────┬───────┘               │
│                                                 │                        │
│  prompts/*.prompt ──► loadAgentPrompts() ──────┼──► agentPrompts Map    │
│                                                 │                        │
│  getProfiles() ────► loadAgentSpecs() ─────────┼──► agentSpecs Map      │
│                                                 │                        │
│                                                 ▼                        │
│  getBehaviorSpec(agentId) ◄───────────── combinePrompts()               │
│         │                                         │                      │
│         │         ┌───────────────────────────────┘                      │
│         │         │                                                      │
│         │         ▼                                                      │
│         │   ┌──────────────────────────────────────────────────┐        │
│         │   │ envRules + agentPrompt + env info                │        │
│         │   └──────────────────────────────────────────────────┘        │
│         │                          │                                    │
│         ▼                          ▼                                    │
│  BehaviorSpec {             combinedPrompt                              │
│    envRules,                (完整 system prompt)                         │
│    agentPrompt,                                                        │
│    combinedPrompt,                                                     │
│    allowedTools,  ───────────────────────────────┐                     │
│    ...                                           │                      │
│  }                                               │                      │
│                                                  │                      │
│  env.getTools() ─────────────────────────────────┼──► Tool[]           │
│                                                  │                      │
│                                                  ▼                      │
│                          filterToolsByPermission(tools, agentSpec)      │
│                                        │                                │
│                                        ▼                                │
│                                  Filtered Tool[]                        │
│                                        │                                │
│                                        ▼                                │
│                              invokeLLM(messages, tools)                 │
│                              (tools 作为 API 参数传递)                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.3 迁移策略

1. **Phase 1**：新增 `rules.md` 支持，与现有 `prompts/` 并存
2. **Phase 2**：`getBehaviorSpec()` 组合两层，Agent 使用组合结果
3. **Phase 3**：移除旧的直接 `getPrompt("system")` 调用，统一走 `getBehaviorSpec()`

## 七、设计优势

1. **分层清晰**
   - Environment 层：共享的安全策略、沟通风格、项目约定
   - Agent 层：特定的角色定义、任务指导、工具权限

2. **复用性强**
   - 同一环境下的所有 agent 共享相同的环境规则
   - 新增 agent 只需添加 prompt 文件，无需重复环境配置

3. **简洁性**
   - 无复杂优先级、无动态注入、无需去重机制
   - 一次 `getBehaviorSpec(agentId)` 返回完整规范

4. **实时性**
   - 每次 query 时获取最新规范
   - 切换环境时自动刷新

5. **一致性**
   - 符合 "Environment 是 Agent 的运行时上下文" 的设计理念
   - 与现有 `EnvironmentAgentSpec` 完美融合

6. **职责分离**
   - System prompt：行为规范和角色定义
   - Tools 参数：通过 LLM API 传递，由 `allowedTools/deniedTools` 过滤

## 八、未来扩展

### 8.1 远程规则加载

```typescript
interface BehaviorSpecSource {
  type: "file" | "url" | "custom";
  path?: string;
  url?: string;
  loader?: () => Promise<string>;
}

// 支持从远程加载环境规则
async loadEnvRulesFromUrl(url: string): Promise<void>;
```

### 8.2 规则继承（多环境场景）

```typescript
// 环境继承：子环境可以继承父环境的规则
interface EnvironmentConfig {
  extends?: string;  // 继承的父环境名称
  rulesOverride?: string;  // 规则覆盖
}

// 组合：父环境规则 + 子环境覆盖
```

### 8.3 动态规则注入

```typescript
// 在特定场景下注入临时规则
interface BehaviorSpec {
  // ...
  injectedRules?: string;  // 运行时注入的临时规则
}

// 例如：处理敏感数据时自动注入安全规则
async handleSensitiveData() {
  const spec = await env.getBehaviorSpec("system");
  spec.injectedRules = `
    ## Sensitive Data Handling
    - Never log or expose sensitive data
    - Use secure methods for data transmission
  `;
}
```
