# Agent Core Skill 机制设计文档

> 本文档描述 agent-core 中 Skill 机制的实现细节。

## 1. 概述

本文档描述如何在 agent-core 中实现 Skill 机制，使 Environment 能够动态加载和管理 Skills。

## 2. 设计目标

- **动态加载**：切换 env 或启动 server 时重新读取配置，加载新增加的 Skills
- **可发现性**：通过 `listSkills()` 接口可查询 Environment 支持的 Skills
- **可执行性**：提供 skillTool 作为统一的 Skill 调用入口
- **实时更新**：每次调用 `handle_query` 时可获取最新的 tools 信息（包括 Skills）

## 3. 目录结构

### 3.1 Environment 配置路径

```
~/.config/tong_work/agent-core/environments/{envName}/
├── config.jsonc          # 主配置
├── agents.jsonc          # Agent 配置（可选）
├── models.jsonc          # 模型配置（可选）
├── skills/               # Skills 目录（新增）
│   ├── skill-a/         # Skill A 文件夹
│   │   └── skill.md    # Skill 定义（必需）
│   ├── skill-b/
│   │   └── skill.md
│   └── ...
```

### 3.2 skill.md 格式

使用 YAML frontmatter：

```markdown
---
name: Skill A Name
description: Skill A 的功能描述，用于执行特定任务
---

# Skill A Name

这里是技能的详细说明文档内容。
可以包含使用示例、参数说明、注意事项等。
当调用 skillTool 并指定 skill-a 时，返回的是这个文件的内容。
```

**格式要求**：
- 文件名必须是 `skill.md`
- frontmatter 必须包含 `name` 和 `description` 字段
- frontmatter 使用 `---` 包裹
- 正文可以是 Markdown 格式的详细文档

## 4. 类型定义

### 4.1 Skill 元信息

**文件位置**: `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\core\environment\skills\types.ts`

```typescript
interface SkillInfo {
  id: string;           // 从文件夹名称获取
  name: string;         // 从 skill.md frontmatter.name 获取
  description: string; // 从 skill.md frontmatter.description 获取
  path: string;        // skill.md 文件的绝对路径
}
```

## 5. 核心模块实现

### 5.1 SkillLoader

**文件位置**: `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\core\environment\skills\skill-loader.ts`

职责：
- 扫描 Environment 配置路径下的 `skills/` 目录
- 解析每个 Skill 文件夹中的 `skill.md`
- 提取 frontmatter 中的 name 和 description

**核心代码**:

```typescript
export class SkillLoader {
  private skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  async loadAll(): Promise<SkillInfo[]> {
    const skills: SkillInfo[] = [];
    
    try {
      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const skillPath = path.join(this.skillsDir, entry.name, "skill.md");
        try {
          const content = await fs.readFile(skillPath, "utf-8");
          const skillInfo = this.parseSkillMd(content, entry.name, skillPath);
          if (skillInfo) {
            skills.push(skillInfo);
          }
        } catch {
          console.warn(`[SkillLoader] Failed to load skill: ${entry.name}`);
        }
      }
    } catch (error) {
      console.warn(`[SkillLoader] Failed to read skills directory: ${error}`);
    }
    
    return skills;
  }

  private parseSkillMd(content: string, skillId: string, skillPath: string): SkillInfo | null {
    // 解析 YAML frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      console.warn(`[SkillLoader] No frontmatter found in ${skillPath}`);
      return null;
    }

    try {
      const frontmatter = this.parseYamlFrontmatter(match[1]);
      if (!frontmatter.name || !frontmatter.description) {
        console.warn(`[SkillLoader] Missing name or description in ${skillPath}`);
        return null;
      }

      return {
        id: skillId,
        name: frontmatter.name,
        description: frontmatter.description,
        path: skillPath,
      };
    } catch (error) {
      console.warn(`[SkillLoader] Failed to parse frontmatter in ${skillPath}: ${error}`);
      return null;
    }
  }
}
```

### 5.2 skillTool 定义

**文件位置**: `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\core\environment\skills\skill-tool.ts`

**baseSkillTool** - 基础 SkillTool（不含动态 description）:

```typescript
export const baseSkillTool: ToolInfo = {
  name: "skill",
  description: "Execute a skill.",
  parameters: z.object({
    skill: z.string().describe("The skill ID to execute"),
  }),
  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const skillId = args.skill as string;
    const env = (ctx as any).env;

    if (!env) {
      return { success: false, output: "", error: "Environment not available" };
    }

    const skillInfo = env.getSkill(skillId);
    if (!skillInfo) {
      return {
        success: false,
        output: "",
        error: `Skill not found: ${skillId}. Available skills: ${env.listSkills().map((s) => s.id).join(", ")}`,
      };
    }

    // 读取 skill.md 文件内容并返回
    try {
      const fs = await import("fs/promises");
      const content = await fs.readFile(skillInfo.path, "utf-8");
      
      // 提取正文（去除 frontmatter）
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
      const body = bodyMatch ? bodyMatch[1] : content;

      return { success: true, output: body.trim() };
    } catch (error) {
      return { success: false, output: "", error: `Failed to read skill content: ${error}` };
    }
  },
};
```

**createSkillToolWithDescription** - 创建带动态 Description 的 SkillTool:

```typescript
export function createSkillToolWithDescription(skills: SkillInfo[]): ToolInfo {
  const skillsInfo = skills
    .map(s => `- ${s.name}: ${s.description}`)
    .join("\n");

  return {
    ...baseSkillTool,
    description: `Execute a skill. Available skills:\n${skillsInfo}`,
  };
}
```

## 6. Environment 接口扩展

**文件位置**: `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\core\environment\index.ts`

### 6.1 新增方法

```typescript
export interface Environment {
  // ... 现有方法 ...

  /**
   * 获取所有已加载的 Skills 元信息
   */
  listSkills(): SkillInfo[];

  /**
   * 获取单个 Skill 元信息
   */
  getSkill(id: string): SkillInfo | undefined;

  /**
   * 获取 Skills 元信息用于 Tool Description
   */
  getSkillsInfoForToolDescription(): string;
}
```

### 6.2 模块导出

```typescript
export * from "./skills/index.js";
```

## 7. BaseEnvironment 实现

**文件位置**: `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\core\environment\base\base-environment.ts`

### 7.1 Skill 相关属性

```typescript
export abstract class BaseEnvironment implements Environment {
  // ... 现有属性 ...
  
  protected skills: Map<string, SkillInfo> = new Map();
  protected skillsLoaded: boolean = false;
}
```

### 7.2 loadSkills 方法

```typescript
async loadSkills(): Promise<void> {
  const skillsDir = this.getSkillsDirectory();
  if (!skillsDir) {
    console.log("[BaseEnvironment] No skills directory configured");
    return;
  }

  const { SkillLoader } = await import("../skills/skill-loader.js");
  const { createSkillToolWithDescription } = await import("../skills/skill-tool.js");

  try {
    const loader = new SkillLoader(skillsDir);
    const skillInfos = await loader.loadAll();

    this.skills.clear();
    for (const skill of skillInfos) {
      this.skills.set(skill.id, skill);
    }

    if (skillInfos.length > 0) {
      const skillToolWithDesc = createSkillToolWithDescription(skillInfos);
      this.registerTool(skillToolWithDesc);
    }

    console.log(`[BaseEnvironment] Loaded ${this.skills.size} skills`);
  } catch (error) {
    console.error("[BaseEnvironment] Failed to load skills:", error);
  }

  this.skillsLoaded = true;
}
```

### 7.3 接口实现方法

```typescript
listSkills(): SkillInfo[] {
  return Array.from(this.skills.values());
}

getSkill(id: string): SkillInfo | undefined {
  return this.skills.get(id);
}

getSkillsInfoForToolDescription(): string {
  return this.listSkills()
    .map(s => `- ${s.name}: ${s.description}`)
    .join("\n");
}

/**
 * 获取 Skills 目录路径（子类实现）
 */
protected abstract getSkillsDirectory(): string | undefined;
```

## 8. ServerEnvironment 集成

**文件位置**: `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\server\environment.ts`

### 8.1 属性定义

```typescript
export class ServerEnvironment extends BaseEnvironment {
  private skillsDirectory: string | undefined;
  // ...
}
```

### 8.2 getSkillsDirectory 实现

```typescript
protected getSkillsDirectory(): string | undefined {
  return this.skillsDirectory;
}
```

### 8.3 loadFromConfig 中调用 loadSkills

```typescript
async loadFromConfig(): Promise<void> {
  // 1. Load config file
  const rawConfig = await Config_get();
  const config = await resolveConfig(rawConfig);

  // 1.5. Set skills directory and load skills
  if (config.activeEnvironment) {
    const { ConfigPaths } = await import("../config/paths.js");
    this.skillsDirectory = path.join(
      ConfigPaths.environments,
      config.activeEnvironment,
      "skills"
    );
    await this.loadSkills();
  }

  // 2. Load user model preferences
  // ... 其他初始化
}
```

### 8.4 注册 baseSkillTool

```typescript
private async registerDefaultTools(): Promise<void> {
  // ... 注册其他工具 ...

  // Register base skill tool (will be replaced by loadSkills if skills exist)
  const { baseSkillTool } = await import("../core/environment/skills/skill-tool.js");
  this.registerTool(baseSkillTool);

  console.log(`[ServerEnvironment] Registered ${allTools.length + 1} tools (including skill tool)`);
}
```

## 9. 动态加载流程

### 9.1 启动时加载

```
Server 启动
  ↓
ServerEnvironment 构造
  ↓
registerDefaultTools() - 注册 baseSkillTool
  ↓
loadFromConfig() 被调用
  ↓
加载配置文件（从 env 目录）
  ↓
设置 skills 目录路径
  ↓
loadSkills() 被调用
  ↓
扫描 skills/ 目录
  ↓
读取每个 skill 文件夹下的 skill.md
  ↓
解析 frontmatter 提取 name/description
  ↓
createSkillToolWithDescription() 创建新的 skillTool
  ↓
registerTool() 替换旧的 skillTool
```

### 9.2 切换环境时加载

```
切换环境命令
  ↓
ServerEnvironment.switchEnvironment(envName)
  ↓
Config_reload() 重新加载配置
  ↓
loadFromConfig() 被调用
  ↓
更新 skills 目录路径
  ↓
loadSkills() 被调用（重新扫描）
  ↓
skillTool.description 更新为最新的 Skills 列表
```

### 9.3 调用 handle_query 时获取最新 tools

```
用户调用 handle_query()
  ↓
ServerEnvironment.handle_query() 被调用
  ↓
new Agent(..., this.listTools(), ...)  // 获取最新的 tools
  ↓
Agent 内部调用 invokeLLM，使用最新的 tools
  ↓
skillTool 的 description 是最新的
```

关键代码 (`base-environment.ts:416`):
```typescript
const agent = new Agent(event, this as Environment, this.listTools(), prompt, agentContext, undefined, history);
//                                                    ↑ 每次都获取最新的
```

## 10. 测试验证

### 10.1 测试环境创建

创建测试环境:
```
~/.config/tong_work/agent-core/environments/test-env/
├── config.jsonc
└── skills/
    ├── test-skill/
    │   └── skill.md
    └── another-skill/
        └── skill.md
```

### 10.2 验证结果

```bash
# 加载 skills
Loaded skills: 2
- another-skill: Another Skill - Another test skill for testing multiple skills
- test-skill: Test Skill - This is a test skill for validating the skill loading mechanism

# Skill Tool Description
Execute a skill. Available skills:
- Another Skill: Another test skill for testing multiple skills
- Test Skill: This is a test skill for validating the skill loading mechanism
```

## 11. 关键文件索引

| 功能 | 绝对路径 |
|------|----------|
| Skill 类型定义 | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\core\environment\skills\types.ts` |
| SkillLoader | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\core\environment\skills\skill-loader.ts` |
| skillTool 定义 | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\core\environment\skills\skill-tool.ts` |
| Skills 模块导出 | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\core\environment\skills\index.ts` |
| Environment 接口 | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\core\environment\index.ts` |
| BaseEnvironment | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\core\environment\base\base-environment.ts` |
| ServerEnvironment | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\server\environment.ts` |
| Agent | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\core\agent\index.ts` |
| Config 路径 | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\config\paths.ts` |

## 12. 注意事项

- Skill 加载失败不应影响 Environment 的正常启动
- skill.md 必须使用 YAML frontmatter 格式
- 每次 `loadSkills()` 都会创建新的 SkillTool 对象并注册到 Environment，替换旧的
- `handle_query()` 每次被调用时都会通过 `this.listTools()` 获取最新的 tools（包括 skillTool）
- 无需在 invoke_llm 中添加 reloadTools 参数
