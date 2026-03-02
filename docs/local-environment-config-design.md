# Agent-Core 本地环境配置方案

## 1. 背景与目标

### 1.1 背景

当前 agent-core 的环境配置只能存放在全局目录 `~/.config/tong_work/agent-core/environments/`，存在以下问题：

- **无法随项目交付**：环境配置与项目代码分离，团队成员需要手动配置
- **多项目冲突**：同一用户同时开发多个项目时，全局环境配置会相互干扰
- **环境迁移麻烦**：切换电脑或新建项目时，需要重新配置

### 1.2 目标

支持将环境配置放到项目本地的 `./.tong_work/` 目录下，实现：

- 环境配置随项目代码一起版本管理（可选）
- 多项目环境隔离，互不干扰
- 便捷的环境安装命令（从全局安装到本地）

---

## 2. 目录结构设计

### 2.1 项目本地配置结构

```
项目根目录/
├── .tong_work/                         # tong_work 项目配置目录
│   ├── tong_work.jsonc                 # 项目级全局配置
│   ├── auth.json                       # 项目级认证配置（可选）
│   ├── environments/                  # 项目级环境目录
│   │   └── {env-name}/
│   │       ├── config.jsonc            # 环境配置
│   │       ├── agents.jsonc            # 代理配置（可选）
│   │       ├── skills/                 # 技能目录（可选）
│   │       ├── mcpservers/            # MCP 服务器目录（可选）
│   │       ├── prompts/               # 提示词目录（可选）
│   │       └── rules.md               # 行为规范（可选）
│   └── prompts/                        # 项目级提示词目录（可选）
├── src/
├── package.json
└── ...
```

### 2.2 全局配置结构（保持不变）

```
~/.config/tong_work/agent-core/
├── tong_work.jsonc                     # 用户全局配置
├── auth.json                           # 用户认证配置
└── environments/                       # 用户全局环境目录
    └── {env-name}/
        ├── config.jsonc
        ├── skills/
        ├── mcpservers/
        └── ...
```

---

## 3. 优先级设计

### 3.1 配置源优先级

| 优先级 | 来源 | 路径 | 说明 |
|--------|------|------|------|
| 1 (最高) | 环境目录 | `./.tong_work/environments/{env}` | 项目本地环境 |
| 2 | 全局配置 | `./.tong_work/tong_work.jsonc` | 项目级全局配置 |
| 3 | 环境目录 | `~/.config/tong_work/agent-core/environments/{env}` | 全局环境 |
| 4 (最低) | 全局配置 | `~/.config/tong_work/agent-core/tong_work.jsonc` | 用户全局配置 |

### 3.2 加载流程

```
1. 加载用户全局配置 (~/.config/tong_work/agent-core/tong_work.jsonc)
   ↓
2. 加载项目级全局配置 (./.tong_work/tong_work.jsonc，覆盖前者)
   ↓
3. 读取 activeEnvironment 字段
   ↓
4. 搜索环境配置（按优先级）：
   a. 先查 ./.tong_work/environments/{env}
   b. 再查 ~/.config/tong_work/agent-core/environments/{env}
   ↓
5. 加载找到的环境配置
```

### 3.3 配置合并示例

假设：

**全局** `~/.config/tong_work/agent-core/tong_work.jsonc`:
```json
{
  "activeEnvironment": "os_env",
  "defaultModel": "claude-3-sonnet",
  "provider": { "openai": {...} }
}
```

**项目** `./.tong_work/tong_work.jsonc`:
```json
{
  "activeEnvironment": "zst",
  "trace": { "enabled": true }
}
```

**最终合并结果**:
```json
{
  "activeEnvironment": "zst",        // 项目覆盖全局
  "defaultModel": "claude-3-sonnet", // 继承全局
  "provider": { "openai": {...} },   // 继承全局
  "trace": { "enabled": true }      // 项目独有
}
```

项目级配置只写需要覆盖的字段，其他字段自动继承全局。

---

## 4. 配置字段设计

### 4.1 tong_work.jsonc 新增字段

```jsonc
{
  // === 现有字段 ===

  // 当前激活的 Agent 运行时 Environment
  "activeEnvironment": "zst",

  // === 新增字段 ===

  // 环境搜索路径配置（可选，默认 ["local", "global"]）
  // - "local": ./.tong_work/environments
  // - "global": ~/.config/tong_work/agent-core/environments
  "environmentSearchPaths": ["local", "global"],

  // 显式指定环境路径（优先级最高，可覆盖 searchPaths）
  // 用途：指定非标准位置的配置
  "environmentOverrides": {
    "zst": "./.tong_work/environments/zst",
    "dev": "/path/to/dev-env"
  }
}
```

### 4.2 字段类型定义

```typescript
// config/types.ts 新增

// 环境搜索路径类型
const EnvironmentSearchPathSchema = z.enum(["local", "global"])
  .describe("环境搜索路径: local=项目本地, global=全局");

// 环境覆盖路径类型
const EnvironmentOverridesSchema = z.record(z.string(), z.string())
  .describe("显式指定环境路径，优先级高于 searchPaths");

// Config schema 扩展
export const ConfigSchema = z.object({
  // ... 现有字段

  // 新增字段
  environmentSearchPaths: z.array(EnvironmentSearchPathSchema).optional()
    .default(["local", "global"])
    .describe("环境搜索路径顺序"),
  environmentOverrides: EnvironmentOverridesSchema.optional()
    .describe("显式指定环境路径"),
});
```

---

## 5. 核心模块改造

### 5.1 paths.ts 改造

**文件**: `packages/core/src/config/paths.ts`

```typescript
class ConfigPathsClass {
  // ... 现有 getter

  // 新增：项目级路径
  get projectConfig(): string {
    return path.join(process.cwd(), ".tong_work");
  }

  get projectTongWorkConfig(): string {
    return path.join(this.projectConfig, "tong_work.jsonc");
  }

  get projectEnvironments(): string {
    return path.join(this.projectConfig, "environments");
  }

  get projectAuth(): string {
    return path.join(this.projectConfig, "auth.json");
  }

  get projectPrompts(): string {
    return path.join(this.projectConfig, "prompts");
  }

  // 保留：全局路径
  get globalConfig(): string {
    return path.join(xdg.config, _appDir);
  }

  get globalEnvironments(): string {
    return path.join(xdg.config, _appDir, "environments");
  }
}
```

### 5.2 environment.ts 改造

**文件**: `packages/core/src/config/sources/environment.ts`

```typescript
// 新增：环境搜索配置
interface EnvironmentSearchConfig {
  searchPaths: ("local" | "global")[];
  overrides?: Record<string, string>;
}

// 改造：支持多路径搜索
export async function findEnvironmentPath(
  envName: string,
  searchConfig?: EnvironmentSearchConfig
): Promise<{ path: string; source: "local" | "global" } | null> {
  // 1. 检查 overrides（优先级最高）
  if (searchConfig?.overrides?.[envName]) {
    const overridePath = searchConfig.overrides[envName];
    if (await pathExists(overridePath)) {
      return { path: overridePath, source: "local" };
    }
  }

  // 2. 按 searchPaths 顺序搜索
  for (const sourceType of (searchConfig?.searchPaths || ["local", "global"])) {
    let envPath: string;

    if (sourceType === "local") {
      envPath = path.join(ConfigPaths.projectEnvironments, envName);
    } else {
      envPath = path.join(ConfigPaths.environments, envName);
    }

    if (await pathExists(envPath)) {
      return { path: envPath, source: sourceType };
    }
  }

  return null;
}

// 改造：loadEnvironmentConfig 支持多路径搜索
export async function loadEnvironmentConfig(
  envName: string,
  searchConfig?: EnvironmentSearchConfig
): Promise<Config.Info | null> {
  const envInfo = await findEnvironmentPath(envName, searchConfig);
  
  if (!envInfo) {
    console.warn(`[Config] Environment "${envName}" not found`);
    return null;
  }

  return loadEnvironmentConfigFromPath(envInfo.path, envInfo.source);
}

// 保留：原有函数兼容
export async function loadEnvironmentConfigFromPath(
  envPath: string,
  source: "local" | "global"
): Promise<Config.Info | null> {
  // 现有逻辑...
}
```

### 5.3 default-sources.ts 改造

**文件**: `packages/core/src/config/default-sources.ts`

```typescript
export async function initWithEnvOverrides(): Promise<void> {
  // 1. 加载 auth（先全局后项目本地，后者覆盖前者）
  await Auth_loadToEnv();
  await loadProjectAuth();  // 新增：加载项目级 auth

  // 2. 注册全局配置源（优先级 0）
  configRegistry.register(globalSource);

  // 3. 加载项目级配置源（优先级 5，覆盖全局）
  const projectSource = createProjectSource();  // 新增
  if (await pathExists(ConfigPaths.projectTongWorkConfig)) {
    configRegistry.register(projectSource);
  }

  // 4. 获取 activeEnvironment
  const config = await Config_get();
  const activeEnv = config.activeEnvironment;

  // 5. 注册环境配置源（优先级 10）
  if (activeEnv) {
    const searchConfig: EnvironmentSearchConfig = {
      searchPaths: config.environmentSearchPaths || ["local", "global"],
      overrides: config.environmentOverrides,
    };
    configRegistry.register(
      createEnvironmentSourceWithSearch(activeEnv, 10, searchConfig)
    );
  }

  // 6. Inline 和 File 配置（优先级 100/200）
  // ... 现有逻辑
}

// 新增：创建项目级配置源
function createProjectSource(): ConfigSource {
  return {
    name: "project",
    priority: 5,  // 高于全局的 0
    load: () => loadProjectConfig(),
  };
}

async function loadProjectConfig(): Promise<Config.Info | null> {
  const configPath = ConfigPaths.projectTongWorkConfig;
  if (!(await pathExists(configPath))) {
    return null;
  }
  // 解析 JSONC...
}
```

---

## 6. 命令设计

### 6.1 新增 /tong_work env install 命令

**功能**：将全局环境安装到项目本地

```bash
# 基本用法
/tong_work env install <env-name>

# 示例：将全局的 zst 环境安装到项目本地
/tong_work env install zst

# 指定目标路径
/tong_work env install zst --target ./custom-env

# 复制并重命名
/tong_work env install zst --as my-zst
```

**实现逻辑**：

```typescript
async function handleInstallAction(action: AgentEnvAction): Promise<CommandResult> {
  const { envName, target, as } = action;
  
  // 1. 查找源环境（只在全局查找）
  const sourcePath = path.join(ConfigPaths.environments, envName);
  if (!await pathExists(sourcePath)) {
    return { success: false, message: `Global environment "${envName}" not found` };
  }

  // 2. 确定目标路径
  const targetName = as || envName;
  const targetPath = target 
    ? path.resolve(target)
    : path.join(ConfigPaths.projectEnvironments, targetName);

  // 3. 复制目录
  await fs.cp(sourcePath, targetPath, { recursive: true });

  // 4. 如果使用了 --as，重命名 config.jsonc 中的 id
  if (as) {
    await renameEnvironmentId(targetPath, as);
  }

  return { success: true, message: `Environment "${envName}" installed to ${targetPath}` };
}
```

### 6.2 现有命令扩展

**/tong_work env list** 扩展：

```bash
# 只显示全局环境
/tong_work env list --global

# 只显示项目本地环境
/tong_work env list --local

# 显示所有环境（默认）
/tong_work env list --all

# 显示环境来源
/tong_work env list -v
```

---

## 7. 兼容性设计

### 7.1 向后兼容

- **现有全局配置不受影响**：全局配置加载逻辑保持不变
- **渐进增强**：用户可以不创建 `.tong_work/` 目录，完全使用全局配置
- **无感知切换**：当项目本地和全局存在同名环境时，按优先级自动选择

### 7.2 .gitignore 建议

```gitignore
# .tong_work 目录的版本控制策略由团队自行决定

# 方案 A：完全忽略
.tong_work/

# 方案 B：只忽略敏感文件
.tong_work/auth.json
.tong_work/**/*.jsonc

# 方案 C：完全提交（适合团队共享配置）
# .tong_work/
```

---

## 8. 实施计划

### 8.1 阶段一：基础支持

- [ ] 改造 `config/paths.ts`：新增项目级路径 getter
- [ ] 改造 `config/sources/environment.ts`：支持多路径搜索
- [ ] 改造 `config/default-sources.ts`：支持加载项目级配置
- [ ] 单元测试覆盖

### 8.2 阶段二：命令增强

- [ ] 扩展 `/tong_work env list` 支持 `--local/--global`
- [ ] 实现 `/tong_work env install` 命令
- [ ] TUI 环境选择器显示环境来源

### 8.3 阶段三：完善

- [ ] 项目级 auth.json 支持
- [ ] 环境覆盖配置 `environmentOverrides` 支持
- [ ] 文档更新

---

## 9. 风险与限制

1. **路径依赖 `process.cwd()`**：项目必须从根目录启动，否则路径可能错误
2. **环境冲突**：同名环境下，本地会覆盖全局，需明确提示用户
3. **技能隔离**：本地环境的 skills 加载后，全局同名 skills 会被忽略
