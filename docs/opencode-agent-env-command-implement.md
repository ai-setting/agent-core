# AgentEnv Command 实现说明文档

> 本文档面向需要理解 agent-env command 完整实现逻辑的开发者或 Agent。
> 通过阅读本文档及引用的绝对路径文件，可以快速掌握实现细节。

## 一、总体架构

AgentEnv Command 是一个后端命令，用于管理 agent-core 的 Environment 配置。它支持以下功能：

- **list**: 列出所有已配置的 Environments
- **select**: 切换到指定的 Environment
- **create**: 创建新的 Environment
- **update**: 更新 Environment 配置
- **delete**: 删除 Environment

架构采用后端执行模式：
- Server 端处理所有数据操作（文件系统读写）
- TUI 端仅负责展示和交互
- 通过 HTTP API 进行通信
- 返回 `mode: "dialog"` 标记触发 TUI 打开 Dialog

## 二、核心流程

```
用户输入 / 并选择 /agent-env
    │
    ├─ CommandDialog 调用 executeCommand("agent-env")
    │
    ├─ POST /commands/agent-env → Server 端 agentEnvCommand.execute()
    │
    ├─ Server 返回 { mode: "dialog", environments: [...], activeEnvironment: "..." }
    │
    └─ TUI 检测到 mode === "dialog"
            → dialog.replace(() => <AgentEnvDialog data={result.data} />)
            → 打开 Environment 管理弹窗
            → 用户操作:
                ├─ 切换: 调用 agent-env with action: "select"
                ├─ 创建: 调用 agent-env with action: "create"
                ├─ 修改: 调用 agent-env with action: "update"
                └─ 删除: 调用 agent-env with action: "delete"
```

## 三、Server 端实现详解

### 3.1 文件位置

**绝对路径**: `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\server\command\built-in\agent-env.ts`

### 3.2 核心代码解析

#### Action 类型定义（第 20-26 行）

```typescript
interface AgentEnvAction {
  type: "list" | "select" | "create" | "update" | "delete";
  envName?: string;
  config?: Partial<EnvironmentConfig>;
}
```

- `type`: 操作类型，支持 list/select/create/update/delete
- `envName`: 目标 Environment 名称
- `config`: 创建或更新时的配置数据

#### Environment 信息结构（第 39-48 行）

```typescript
interface EnvironmentInfo {
  id: string;                    // Environment 标识符
  displayName: string;           // 显示名称
  description?: string;          // 描述
  isActive: boolean;             // 是否当前激活
  configPath: string;            // 配置文件路径
  createdAt?: string;            // 创建时间
  updatedAt?: string;            // 更新时间
}
```

#### Command 定义（第 51-89 行）

```typescript
export const agentEnvCommand: Command = {
  name: "agent-env",
  displayName: "Agent Environment",
  description: "Manage agent environments (list, switch, create, update, delete)",
  hasArgs: false,

  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    // Parse action from JSON args
    let action: AgentEnvAction;
    try {
      action = args ? JSON.parse(args) : { type: "list" };
    } catch {
      return {
        success: false,
        message: "Invalid arguments",
        data: { error: "Invalid JSON" },
      };
    }

    // Route to specific handler
    switch (action.type) {
      case "list": return await handleListAction();
      case "select": return await handleSelectAction(context, action);
      case "create": return await handleCreateAction(action);
      case "update": return await handleUpdateAction(action);
      case "delete": return await handleDeleteAction(action);
      default: return { success: false, message: "Unknown action" };
    }
  },
};
```

#### list Action 实现（第 95-137 行）

```typescript
async function handleListAction(): Promise<CommandResult> {
  // 1. 获取当前激活的 Environment
  const config = await Config_get();
  const activeEnv = config.activeEnvironment;

  // 2. 扫描 environments 目录
  const envsDir = ConfigPaths.environments;
  const environments: EnvironmentInfo[] = [];

  const entries = await fs.readdir(envsDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // 3. 加载每个 Environment 的配置
      const envConfig = await loadEnvironmentConfig(entry.name);
      
      environments.push({
        id: entry.name,
        displayName: envConfig?.environment?.displayName || entry.name,
        description: envConfig?.environment?.description,
        isActive: entry.name === activeEnv,
        configPath: path.join(envsDir, entry.name, "config.jsonc"),
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
      });
    }
  }

  // 4. 返回 dialog 数据
  return {
    success: true,
    message: "Opening environment manager",
    data: {
      mode: "dialog",
      environments,
      activeEnvironment: activeEnv,
    },
  };
}
```

#### select Action 实现（第 143-198 行）

```typescript
async function handleSelectAction(context, action): Promise<CommandResult> {
  // 1. 验证环境存在
  const envDir = path.join(ConfigPaths.environments, action.envName);
  await fs.access(envDir);  // 如果不存在会抛出错误

  // 2. 更新全局配置中的 activeEnvironment
  const globalConfigPath = path.join(ConfigPaths.config, "tong_work.jsonc");
  const content = await fs.readFile(globalConfigPath, "utf-8");
  const globalConfig = JSON.parse(content);

  globalConfig.activeEnvironment = action.envName;
  
  await fs.writeFile(
    globalConfigPath,
    JSON.stringify(globalConfig, null, 2),
    "utf-8"
  );

  // 3. 重新加载配置
  await Config_reload();

  // 4. 如果环境支持，触发环境切换
  if (context.env && "switchEnvironment" in context.env) {
    await (context.env as any).switchEnvironment(action.envName);
  }

  return {
    success: true,
    message: `Switched to environment: ${action.envName}`,
    data: { environment: action.envName, reloaded: true },
  };
}
```

#### create Action 实现（第 204-261 行）

```typescript
async function handleCreateAction(action): Promise<CommandResult> {
  // 1. 验证名称格式
  if (!/^[a-zA-Z0-9_-]+$/.test(action.envName)) {
    return {
      success: false,
      message: "Invalid environment name...",
    };
  }

  const envDir = path.join(ConfigPaths.environments, action.envName);

  // 2. 检查是否已存在
  try {
    await fs.access(envDir);
    return { success: false, message: `Environment "${action.envName}" already exists` };
  } catch {
    // 不存在，继续
  }

  // 3. 创建目录
  await fs.mkdir(envDir, { recursive: true });

  // 4. 创建默认配置文件
  const defaultConfig = {
    id: action.envName,
    displayName: action.config?.displayName || action.envName,
    description: action.config?.description || "",
    capabilities: {
      logs: true,
      events: true,
      metrics: true,
      profiles: true,
      mcpTools: false,
    },
  };

  const configPath = path.join(envDir, "config.jsonc");
  await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 2), "utf-8");

  return {
    success: true,
    message: `Environment "${action.envName}" created successfully`,
    data: { environment: action.envName, path: envDir },
  };
}
```

#### delete Action 实现（第 309-341 行）

```typescript
async function handleDeleteAction(action): Promise<CommandResult> {
  // 1. 检查是否是当前激活的环境
  const config = await Config_get();
  if (config.activeEnvironment === action.envName) {
    return {
      success: false,
      message: `Cannot delete the active environment...`,
    };
  }

  const envDir = path.join(ConfigPaths.environments, action.envName);

  // 2. 递归删除目录
  await fs.rm(envDir, { recursive: true, force: true });

  return {
    success: true,
    message: `Environment "${action.envName}" deleted successfully`,
  };
}
```

### 3.3 依赖模块

| 模块 | 绝对路径 | 用途 |
|------|----------|------|
| ConfigPaths | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\config\paths.ts` | 获取 environments 目录路径 |
| Config_get | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\config\config.ts` | 获取当前配置 |
| Config_reload | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\config\config.ts` | 重新加载配置 |
| loadEnvironmentConfig | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\config\sources\environment.ts` | 加载指定 Environment 配置 |

### 3.4 命令注册

命令注册在 **第 38-42 行** 的 `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\server\index.ts`：

```typescript
import { agentEnvCommand } from "./command/built-in/agent-env.js";

// ...

const commandRegistry = CommandRegistry.getInstance();
commandRegistry.register(echoCommand);
commandRegistry.register(connectCommand);
commandRegistry.register(modelsCommand);
commandRegistry.register(agentEnvCommand);  // 新增
```

## 四、TUI 端实现详解

### 4.1 文件位置

**绝对路径**: `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\cli\tui\components\AgentEnvDialog.tsx`

### 4.2 组件结构

#### Props 类型定义（第 16-22 行）

```typescript
interface AgentEnvDialogData {
  environments: EnvironmentInfo[];
  activeEnvironment?: string;
}

interface AgentEnvDialogProps {
  data: AgentEnvDialogData;
}
```

#### View 状态类型（第 24-29 行）

```typescript
type DialogView = 
  | { type: "list" }                    // 列表视图
  | { type: "create" }                  // 创建视图
  | { type: "edit"; env: EnvironmentInfo }      // 编辑视图
  | { type: "confirm_delete"; env: EnvironmentInfo };  // 确认删除视图
```

#### 组件状态（第 32-47 行）

```typescript
export function AgentEnvDialog(props: AgentEnvDialogProps) {
  const command = useCommand();
  const dialog = useDialog();
  const theme = useTheme();

  const [view, setView] = createSignal<DialogView>({ type: "list" });
  const [filter, setFilter] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [environments, setEnvironments] = createSignal(props.data.environments);
  const [message, setMessage] = createSignal<{ text: string; type: "success" | "error" } | null>(null);

  // 表单状态
  const [formName, setFormName] = createSignal("");
  const [formDisplayName, setFormDisplayName] = createSignal("");
  const [formDescription, setFormDescription] = createSignal("");
}
```

### 4.3 关键方法

#### 过滤逻辑（第 55-62 行）

```typescript
const filteredEnvs = createMemo(() => {
  const f = filter().toLowerCase().trim();
  if (!f) return environments();
  return environments().filter(env => 
    env.displayName.toLowerCase().includes(f) ||
    env.id.toLowerCase().includes(f) ||
    (env.description && env.description.toLowerCase().includes(f))
  );
});
```

#### 键盘处理（第 72-117 行）

```typescript
const handleListKeyDown = (key: string): boolean => {
  switch (key.toLowerCase()) {
    case "up":
    case "arrowup":
      moveSelection(-1);
      return true;
    case "down":
    case "arrowdown":
      moveSelection(1);
      return true;
    case "return":
    case "enter":
      selectEnv();  // 切换环境
      return true;
    case "escape":
      dialog.pop();  // 关闭对话框
      return true;
    case "n":
      setView({ type: "create" });  // 打开创建视图
      return true;
    case "d":
      // 打开删除确认视图
      const env = filteredEnvs()[selectedIndex()];
      if (env && !env.isActive) {
        setView({ type: "confirm_delete", env });
      }
      return true;
    case "e":
      // 打开编辑视图
      const editEnv = filteredEnvs()[selectedIndex()];
      if (editEnv) {
        setView({ type: "edit", env: editEnv });
      }
      return true;
    default:
      return false;
  }
};
```

#### 切换环境（第 119-145 行）

```typescript
const selectEnv = async () => {
  const env = filteredEnvs()[selectedIndex()];
  if (!env || env.isActive) return;

  const result = await command.executeCommand(
    "agent-env",
    JSON.stringify({ type: "select", envName: env.id })
  );

  if (result.success) {
    setMessage({ text: result.message || "Environment switched", type: "success" });
    // 更新列表中的激活状态
    setEnvironments(prev => prev.map(e => ({
      ...e,
      isActive: e.id === env.id
    })));
  } else {
    setMessage({ text: result.message || "Failed to switch", type: "error" });
  }
};
```

#### 创建环境（第 147-175 行）

```typescript
const createEnv = async () => {
  const name = formName().trim();
  const displayName = formDisplayName().trim() || name;
  const description = formDescription().trim();

  if (!name) {
    setMessage({ text: "Name is required", type: "error" });
    return;
  }

  const result = await command.executeCommand(
    "agent-env",
    JSON.stringify({
      type: "create",
      envName: name,
      config: { displayName, description }
    })
  );

  if (result.success) {
    setMessage({ text: result.message || "Environment created", type: "success" });
    setView({ type: "list" });
    refreshList();
  } else {
    setMessage({ text: result.message || "Failed to create", type: "error" });
  }
};
```

### 4.4 UI 布局

组件使用 SolidJS 的 `<Show>` 和 `<For>` 进行条件渲染，包含四个视图：

1. **列表视图 (renderListView)**: 第 242-317 行
   - 标题栏、搜索框、环境列表
   - 显示激活状态（★ 标记）
   - 消息提示区域
   - 底部操作提示

2. **创建视图 (renderCreateView)**: 第 319-363 行
   - 名称、显示名称、描述输入框
   - Enter 确认，Esc 取消

3. **编辑视图 (renderEditView)**: 第 365-403 行
   - 显示名称、描述输入框（名称不可修改）

4. **确认删除视图 (renderConfirmDeleteView)**: 第 405-447 行
   - 显示要删除的环境信息
   - Enter 确认删除，Esc 取消

### 4.5 CommandDialog 集成

在 **第 175-182 行** 的 `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\cli\tui\components\CommandDialog.tsx`：

```typescript
case "agent-env": {
  tuiLogger.info("[CommandDialog] Importing AgentEnvDialog...");
  const { AgentEnvDialog } = await import("./AgentEnvDialog.js");
  tuiLogger.info("[CommandDialog] AgentEnvDialog imported, calling replace");
  dialog.replace(() => <AgentEnvDialog data={(result.data as any)} />);
  tuiLogger.info("[CommandDialog] AgentEnvDialog replace called");
  break;
}
```

## 五、数据流

```
User opens AgentEnvDialog
    │
    ├─ Server scans ~/.config/tong_work/agent-core/environments/
    │   ├─ For each directory:
    │   │   ├─ Read config.jsonc
    │   │   └─ Get file stats (createdAt, updatedAt)
    │   └─ Check against activeEnvironment from Config
    │
    ├─ Server returns { environments, activeEnvironment }
    │
    └─ TUI renders list
        │
        ├─ User creates environment:
        │   ├─ POST { type: "create", envName, config }
        │   ├─ Server: mkdir + write config.jsonc
        │   └─ Server returns success → TUI refresh list
        │
        ├─ User switches environment:
        │   ├─ POST { type: "select", envName }
        │   ├─ Server: update tong_work.jsonc activeEnvironment
        │   ├─ Server: Config_reload()
        │   └─ Server returns success → TUI update active status
        │
        └─ User deletes environment:
            ├─ POST { type: "delete", envName }
            ├─ Server: rm -rf directory
            └─ Server returns success → TUI refresh list
```

## 六、API 参考

### 6.1 Request/Response 示例

**List Action**
```json
// Request
{ "type": "list" }

// Response
{
  "success": true,
  "data": {
    "mode": "dialog",
    "environments": [
      {
        "id": "os_env",
        "displayName": "OS Environment",
        "description": "Operating system environment",
        "isActive": true,
        "configPath": "~/.config/tong_work/agent-core/environments/os_env/config.jsonc",
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-01T00:00:00Z"
      }
    ],
    "activeEnvironment": "os_env"
  }
}
```

**Select Action**
```json
// Request
{ "type": "select", "envName": "web_env" }

// Response
{
  "success": true,
  "message": "Switched to environment: web_env",
  "data": {
    "environment": "web_env",
    "reloaded": true
  }
}
```

**Create Action**
```json
// Request
{
  "type": "create",
  "envName": "new_env",
  "config": {
    "displayName": "New Environment",
    "description": "Description"
  }
}

// Response
{
  "success": true,
  "message": "Environment \"new_env\" created successfully",
  "data": {
    "environment": "new_env",
    "path": "..."
  }
}
```

**Update Action**
```json
// Request
{
  "type": "update",
  "envName": "os_env",
  "config": {
    "displayName": "Updated Name",
    "description": "New description"
  }
}

// Response
{
  "success": true,
  "message": "Environment \"os_env\" updated successfully"
}
```

**Delete Action**
```json
// Request
{ "type": "delete", "envName": "old_env" }

// Response
{
  "success": true,
  "message": "Environment \"old_env\" deleted successfully"
}
```

## 七、关键文件索引

| 功能 | 绝对路径 | 关键行号 |
|------|----------|----------|
| 命令定义 | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\server\command\built-in\agent-env.ts` | 51-89 |
| list action | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\server\command\built-in\agent-env.ts` | 95-137 |
| select action | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\server\command\built-in\agent-env.ts` | 143-198 |
| create action | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\server\command\built-in\agent-env.ts` | 204-261 |
| update action | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\server\command\built-in\agent-env.ts` | 267-303 |
| delete action | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\server\command\built-in\agent-env.ts` | 309-341 |
| Dialog 组件 | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\cli\tui\components\AgentEnvDialog.tsx` | 31-454 |
| CommandDialog 集成 | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\cli\tui\components\CommandDialog.tsx` | 175-182 |
| 命令注册 | `D:\document\zhishitong_workspace\zst_project\tong_work\agent-core\packages\core\src\server\index.ts` | 38-42 |

## 八、扩展指南

### 8.1 添加新的 action type

1. 在 `AgentEnvAction` 接口中添加新的 type
2. 在 `agentEnvCommand.execute` 的 switch 中添加新的 case
3. 实现对应的 handler 函数
4. 在 Dialog 组件中添加对应的 UI 处理

### 8.2 修改 Environment 配置结构

1. 更新 `EnvironmentConfig` 接口（第 28-40 行）
2. 更新 `handleCreateAction` 中的默认配置生成
3. 更新 `handleUpdateAction` 中的字段合并逻辑
4. 如果需要，更新 TUI 端的表单字段

## 九、注意事项

1. **名称验证**: 创建 Environment 时只允许字母、数字、下划线、连字符（第 210-215 行）
2. **激活保护**: 不能删除当前激活的 Environment（第 318-324 行）
3. **配置重载**: 切换 Environment 后必须调用 `Config_reload()`（第 186 行）
4. **路径解析**: Environment 配置存储在 `ConfigPaths.environments` 目录下
5. **文件权限**: 创建的文件使用默认权限，由操作系统决定
6. **并发安全**: 文件操作没有加锁，并发修改可能导致数据丢失
7. **错误处理**: 所有文件操作都有 try-catch，返回友好的错误消息
