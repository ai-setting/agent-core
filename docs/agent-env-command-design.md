# AgentEnv Command 设计文档

## 1. 概述

AgentEnv Command 用于管理 agent-core 的 Environment 配置，允许用户通过 TUI 界面查看、切换、创建、修改和删除 Environment。

### 1.1 命令用途

- **查看 (list)**: 列出所有已配置的 Environments，显示当前激活的 Environment
- **切换 (select)**: 切换到指定的 Environment 并重新加载配置
- **创建 (create)**: 创建新的 Environment 目录和基础配置文件
- **修改 (update)**: 修改 Environment 的配置信息
- **删除 (delete)**: 删除指定的 Environment 及其配置

### 1.2 设计原则

1. **后端执行**: 所有逻辑在 Server 端执行，TUI 仅负责展示和交互
2. **持久化**: Environment 配置存储在文件系统，`~/.config/tong_work/agent-core/environments/`
3. **实时切换**: 切换 Environment 后立即生效，无需重启 Server
4. **安全删除**: 删除前需要确认，且不能删除当前激活的 Environment

### 1.3 与现有命令的差异/关联

- 类似 `/models` 命令的交互模式：list → dialog → select
- 与 Environment 配置系统深度集成
- 不同于 `connect` 的会话管理，这是配置级别的 Environment 切换

## 2. 总体架构

### 2.1 命令类型

- **后端命令**: 通过 HTTP API `/commands/agent-env` 调用
- **Dialog 模式**: 返回 `mode: "dialog"` 标记，TUI 打开 AgentEnvDialog
- **多 Action 支持**: 支持 list, select, create, update, delete 多种操作

### 2.2 核心流程

```
用户输入 / 并选择 /agent-env
    │
    ├─ CommandPalette 调用 executeCommand("agent-env")
    │
    ├─ POST /commands/agent-env → Server 端 agentEnvCommand.execute()
    │
    ├─ Server 返回 { mode: "dialog", environments: [...], activeEnv: "..." }
    │
    └─ TUI 检测到 mode === "dialog"
            → dialog.replace(() => <AgentEnvDialog data={result.data} />)
            → 打开 Environment 管理弹窗
            → 用户选择操作:
                ├─ 切换: 调用 agent-env with action: "select"
                ├─ 创建: 打开创建表单 → 调用 action: "create"
                ├─ 修改: 打开编辑表单 → 调用 action: "update"
                └─ 删除: 确认后调用 action: "delete"
```

## 3. Server 端实现设计

### 3.1 文件位置

- **命令实现**: `packages/core/src/server/command/built-in/agent-env.ts`
- **注册文件**: `packages/core/src/server/command/built-in/index.ts`

### 3.2 Command 定义

```typescript
// packages/core/src/server/command/built-in/agent-env.ts

import type { Command, CommandContext, CommandResult } from "../types.js";
import fs from "fs/promises";
import path from "path";
import { ConfigPaths } from "../../../config/paths.js";
import { Config_get, Config_reload } from "../../../config/config.js";

interface AgentEnvAction {
  type: "list" | "select" | "create" | "update" | "delete";
  envName?: string;
  config?: Partial<EnvironmentConfig>;
}

interface EnvironmentConfig {
  id: string;
  displayName: string;
  description?: string;
  defaultModel?: string;
  baseURL?: string;
  apiKey?: string;
}

interface EnvironmentInfo {
  id: string;
  displayName: string;
  description?: string;
  isActive: boolean;
  configPath: string;
  createdAt?: string;
  updatedAt?: string;
}

export const agentEnvCommand: Command = {
  name: "agent-env",
  displayName: "Agent Environment",
  description: "Manage agent environments (list, switch, create, update, delete)",
  hasArgs: false,

  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    // Parse action
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

    switch (action.type) {
      case "list": {
        return await handleListAction();
      }

      case "select": {
        return await handleSelectAction(context, action);
      }

      case "create": {
        return await handleCreateAction(action);
      }

      case "update": {
        return await handleUpdateAction(action);
      }

      case "delete": {
        return await handleDeleteAction(action);
      }

      default:
        return {
          success: false,
          message: `Unknown action: ${(action as AgentEnvAction).type}`,
        };
    }
  },
};
```

### 3.3 依赖服务

| 模块 | 路径 | 用途 |
|------|------|------|
| ConfigPaths | `packages/core/src/config/paths.ts` | 获取 environments 目录路径 |
| Config_get | `packages/core/src/config/config.ts` | 获取当前配置（含 activeEnvironment）|
| Config_reload | `packages/core/src/config/config.ts` | 重新加载配置 |
| loadEnvironmentConfig | `packages/core/src/config/sources/environment.ts` | 加载指定 Environment 配置 |

## 4. TUI 端实现设计

### 4.1 文件位置

- **Dialog 组件**: `packages/core/src/cli/tui/components/AgentEnvDialog.tsx`
- **集成点**: `packages/core/src/cli/tui/components/CommandDialog.tsx`

### 4.2 组件设计

```typescript
// packages/core/src/cli/tui/components/AgentEnvDialog.tsx

import { createSignal, createMemo, For, Show } from "solid-js";
import { useCommand, useDialog, useTheme } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";

interface EnvironmentInfo {
  id: string;
  displayName: string;
  description?: string;
  isActive: boolean;
  configPath: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AgentEnvDialogData {
  environments: EnvironmentInfo[];
  activeEnvironment?: string;
}

interface AgentEnvDialogProps {
  data: AgentEnvDialogData;
}

type DialogView = 
  | { type: "list" }
  | { type: "create" }
  | { type: "edit"; env: EnvironmentInfo }
  | { type: "confirm_delete"; env: EnvironmentInfo };

export function AgentEnvDialog(props: AgentEnvDialogProps) {
  const command = useCommand();
  const dialog = useDialog();
  const theme = useTheme();

  const [view, setView] = createSignal<DialogView>({ type: "list" });
  const [filter, setFilter] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [environments, setEnvironments] = createSignal(props.data.environments);
  const [message, setMessage] = createSignal<{ text: string; type: "success" | "error" } | null>(null);

  // 过滤后的环境列表
  const filteredEnvs = createMemo(() => {
    const f = filter().toLowerCase().trim();
    if (!f) return environments();
    return environments().filter(env => 
      env.displayName.toLowerCase().includes(f) ||
      env.id.toLowerCase().includes(f) ||
      (env.description && env.description.toLowerCase().includes(f))
    );
  });

  // 键盘导航
  const moveSelection = (direction: -1 | 1) => {
    const list = filteredEnvs();
    if (list.length === 0) return;
    
    let next = selectedIndex() + direction;
    if (next < 0) next = list.length - 1;
    if (next >= list.length) next = 0;
    setSelectedIndex(next);
  };

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
        selectEnv();
        return true;
      case "escape":
        dialog.pop();
        return true;
      case "n":
        // N 键创建新环境
        setView({ type: "create" });
        return true;
      case "d":
        // D 键删除
        const env = filteredEnvs()[selectedIndex()];
        if (env && !env.isActive) {
          setView({ type: "confirm_delete", env });
        }
        return true;
      default:
        return false;
    }
  };

  const selectEnv = async () => {
    const env = filteredEnvs()[selectedIndex()];
    if (!env || env.isActive) return;

    tuiLogger.info("[AgentEnvDialog] Switching environment", { id: env.id });

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

  const createEnv = async (name: string, displayName: string, description: string) => {
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
      // 刷新列表
      refreshList();
    } else {
      setMessage({ text: result.message || "Failed to create", type: "error" });
    }
  };

  const deleteEnv = async () => {
    const currentView = view();
    if (currentView.type !== "confirm_delete") return;
    
    const result = await command.executeCommand(
      "agent-env",
      JSON.stringify({ type: "delete", envName: currentView.env.id })
    );

    if (result.success) {
      setMessage({ text: result.message || "Environment deleted", type: "success" });
      setView({ type: "list" });
      refreshList();
    } else {
      setMessage({ text: result.message || "Failed to delete", type: "error" });
    }
  };

  const refreshList = async () => {
    const result = await command.executeCommand(
      "agent-env",
      JSON.stringify({ type: "list" })
    );
    if (result.success && result.data?.environments) {
      setEnvironments(result.data.environments);
    }
  };

  // 渲染不同视图...
}
```

### 4.3 UI 布局

```
┌─────────────────────────────────────────────────────────────┐
│  Manage Environments                               N: new   │
├─────────────────────────────────────────────────────────────┤
│  > filter...                                                │
├─────────────────────────────────────────────────────────────┤
│  Active                                                     │
│  ★ os_env          OS Environment              Enter switch │
│                                                             │
│  Available                                                  │
│    web_env         Web Environment             Enter switch │
│    custom_env      Custom Environment          Enter switch │
│                                                             │
│  [✓ Environment switched to: web_env]                       │
├─────────────────────────────────────────────────────────────┤
│  ↑↓ navigate • Enter switch • N new • D delete • Esc close  │
└─────────────────────────────────────────────────────────────┘
```

## 5. 数据流与持久化

### 5.1 数据流向

```
User opens AgentEnvDialog
    │
    ├─ Server returns list of environments from filesystem
    │   └─ scans ~/.config/tong_work/agent-core/environments/
    │
    ├─ User selects action
    │
    └─ Server performs operation on filesystem
        ├─ create: mkdir + write config.jsonc
        ├─ select: update tong_work.jsonc activeEnvironment
        ├─ update: rewrite config.jsonc
        └─ delete: rm -rf directory
```

### 5.2 存储方案

**Environment 配置目录**:
```
~/.config/tong_work/agent-core/environments/
├── os_env/
│   ├── config.jsonc
│   ├── agents.jsonc (optional)
│   └── models.jsonc (optional)
├── web_env/
│   └── config.jsonc
└── custom_env/
    └── config.jsonc
```

**全局配置**:
```
~/.config/tong_work/agent-core/tong_work.jsonc
{
  "activeEnvironment": "os_env",
  ...
}
```

## 6. API 设计

### 6.1 Request/Response 格式

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
        "configPath": "...",
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
{
  "type": "select",
  "envName": "web_env"
}

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

**Delete Action**
```json
// Request
{
  "type": "delete",
  "envName": "old_env"
}

// Response
{
  "success": true,
  "message": "Environment \"old_env\" deleted successfully"
}
```

### 6.2 Error 处理

| 错误码 | 场景 | 消息示例 |
|--------|------|----------|
| INVALID_NAME | 创建时名称不合法 | "Invalid environment name..." |
| ALREADY_EXISTS | 创建时已存在 | "Environment \"xxx\" already exists" |
| NOT_FOUND | 操作不存在的 env | "Environment \"xxx\" not found" |
| ACTIVE_ENV | 删除当前激活 env | "Cannot delete the active environment..." |
| FS_ERROR | 文件系统错误 | "Failed to create environment: ..." |

## 7. 实现步骤

### Phase 1: Server 端 (2h)

1. [ ] 创建 `packages/core/src/server/command/built-in/agent-env.ts`
2. [ ] 实现 agentEnvCommand（list/select/create/update/delete）
3. [ ] 在 `index.ts` 中注册命令
4. [ ] 添加单元测试

### Phase 2: TUI 端 (3h)

1. [ ] 创建 `packages/core/src/cli/tui/components/AgentEnvDialog.tsx`
2. [ ] 实现环境列表 UI（显示激活状态）
3. [ ] 实现创建/编辑/删除表单
4. [ ] 实现键盘导航（↑↓/Enter/Esc/N/D）
5. [ ] 实现搜索过滤
6. [ ] 修改 `CommandDialog.tsx` 集成 agent-env

### Phase 3: 集成测试 (1h)

1. [ ] 启动 Server + TUI
2. [ ] 测试 `/agent-env` 命令打开 Dialog
3. [ ] 测试环境切换
4. [ ] 测试创建新环境
5. [ ] 测试删除环境
6. [ ] 验证配置持久化

## 8. 参考文件

| 功能 | 路径 |
|------|------|
| Command Types | `packages/core/src/server/command/types.ts` |
| Models Command (参考) | `packages/core/src/server/command/built-in/models.ts` |
| ModelsDialog (参考) | `packages/core/src/cli/tui/components/ModelsDialog.tsx` |
| CommandDialog | `packages/core/src/cli/tui/components/CommandDialog.tsx` |
| Config Paths | `packages/core/src/config/paths.ts` |
| Environment Source | `packages/core/src/config/sources/environment.ts` |
| Config API | `packages/core/src/config/config.ts` |

## 9. 注意事项

1. **环境变量**: 使用 `AGENT_CORE_TEST_HOME` 覆盖 home 路径进行测试
2. **并发安全**: 文件操作需考虑并发，必要时加锁
3. **配置重载**: 切换环境后需调用 `Config_reload()` 刷新配置
4. **激活保护**: 不能删除当前激活的 Environment
5. **名称验证**: 只允许字母、数字、下划线、连字符
