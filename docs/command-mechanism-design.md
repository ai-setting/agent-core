# Agent Core Command 机制设计文档

> 基于 OpenCode Command 机制参考，适配 Agent Core 架构设计

## 1. 设计目标

在 Agent Core 中实现一套完整的 Command 机制，支持：

1. **Server 端 Command 注册与执行**：在 Server 层统一管理 Commands
2. **Session 与全局两种执行模式**：Command 可在特定 Session 内执行，也可全局执行
3. **TUI 交互体验**：类似 OpenCode 的 `/` 命令触发、自动补全、Tab 选择
4. **可扩展性**：易于添加新的 Command

## 2. 架构设计

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         TUI (Client)                             │
├─────────────────────────────────────────────────────────────────┤
│  InputBox ──► CommandParser ──► CommandPalette                  │
│                                    │                            │
│                                    ▼                            │
│                              CommandContext                     │
│                                    │                            │
└────────────────────┬───────────────┘                            │
                     │ HTTP API                                    │
                     ▼                                             │
┌────────────────────┴───────────────────────────────────────────┐
│                      Server (AgentServer)                       │
├─────────────────────────────────────────────────────────────────┤
│  /commands         GET    ► 获取所有可用 commands               │
│  /commands/:name   POST   ► 执行特定 command                    │
│                                                                  │
│  CommandRegistry  ◄──  CommandRegistrySingleton                │
│       │                                                          │
│       ▼                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   /echo      │  │  (custom)    │  │  (custom)    │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

#### 2.2.1 Command 接口定义

```typescript
// packages/core/src/server/command/types.ts

export interface Command {
  /** Command 名称，用于触发（如 "echo" 对应 "/echo"） */
  name: string;
  
  /** 显示名称 */
  displayName?: string;
  
  /** 描述 */
  description: string;
  
  /** 是否支持参数 */
  hasArgs?: boolean;
  
  /** 参数描述（用于提示） */
  argsDescription?: string;
  
  /** 执行函数 */
  execute: (context: CommandContext, args: string) => Promise<CommandResult>;
}

export interface CommandContext {
  /** Session ID，如果为 undefined 则为全局执行 */
  sessionId?: string;
  
  /** ServerEnvironment 实例 */
  env: ServerEnvironment;
}

export interface CommandResult {
  /** 是否成功 */
  success: boolean;
  
  /** 返回消息 */
  message?: string;
  
  /** 附加数据 */
  data?: unknown;
}
```

#### 2.2.2 CommandRegistry

```typescript
// packages/core/src/server/command/registry.ts

export class CommandRegistry {
  private commands = new Map<string, Command>();
  private static instance: CommandRegistry;
  
  static getInstance(): CommandRegistry {
    if (!CommandRegistry.instance) {
      CommandRegistry.instance = new CommandRegistry();
    }
    return CommandRegistry.instance;
  }
  
  register(command: Command): void {
    this.commands.set(command.name, command);
  }
  
  unregister(name: string): void {
    this.commands.delete(name);
  }
  
  get(name: string): Command | undefined {
    return this.commands.get(name);
  }
  
  list(): Command[] {
    return Array.from(this.commands.values());
  }
}
```

#### 2.2.3 Command 路由

```typescript
// packages/core/src/server/routes/commands.ts

const app = new Hono<Env>();

// GET /commands - 获取所有可用 commands
app.get("/", async (c) => {
  const registry = CommandRegistry.getInstance();
  const commands = registry.list().map(cmd => ({
    name: cmd.name,
    displayName: cmd.displayName,
    description: cmd.description,
    hasArgs: cmd.hasArgs,
    argsDescription: cmd.argsDescription,
  }));
  return c.json(commands);
});

// POST /commands/:name - 执行 command
app.post("/:name", async (c) => {
  const name = c.req.param("name");
  const body = await c.req.json<{ sessionId?: string; args?: string }>();
  const env = c.get("env");
  
  const registry = CommandRegistry.getInstance();
  const command = registry.get(name);
  
  if (!command) {
    return c.json({ error: `Command '${name}' not found` }, 404);
  }
  
  // 创建 command context
  const cmdContext: CommandContext = {
    sessionId: body.sessionId,
    env,
  };
  
  const result = await command.execute(cmdContext, body.args || "");
  return c.json(result);
});
```

### 2.3 TUI 端设计

#### 2.3.1 Command Context

```typescript
// packages/core/src/cli/tui/contexts/command.tsx

export interface CommandItem {
  name: string;
  displayName: string;
  description: string;
  hasArgs: boolean;
  argsDescription?: string;
}

export interface CommandContextValue {
  /** 所有可用 commands */
  commands: Accessor<CommandItem[]>;
  
  /** 是否显示 command palette */
  isOpen: Accessor<boolean>;
  
  /** 当前选中的 command */
  selectedCommand: Accessor<CommandItem | null>;
  
  /** 打开 command palette */
  openPalette: () => void;
  
  /** 关闭 command palette */
  closePalette: () => void;
  
  /** 选择 command */
  selectCommand: (command: CommandItem | null) => void;
  
  /** 执行 command */
  executeCommand: (name: string, args?: string) => Promise<void>;
  
  /** 刷新 command 列表 */
  refreshCommands: () => Promise<void>;
}
```

#### 2.3.2 Command Palette 组件

```typescript
// packages/core/src/cli/tui/components/CommandPalette.tsx

export function CommandPalette() {
  const command = useCommand();
  const theme = useTheme();
  
  const [filter, setFilter] = createSignal("");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  
  const filteredCommands = () => {
    const f = filter().toLowerCase();
    return command.commands().filter(cmd => 
      cmd.name.toLowerCase().includes(f) ||
      cmd.description.toLowerCase().includes(f)
    );
  };
  
  const handleSelect = (cmd: CommandItem) => {
    if (cmd.hasArgs) {
      // 插入 command 到输入框，等待用户输入参数
      command.selectCommand(cmd);
    } else {
      // 直接执行
      command.executeCommand(cmd.name);
    }
    command.closePalette();
  };
  
  return (
    <Show when={command.isOpen()}>
      <box borderStyle="single" borderColor={theme.theme().primary}>
        <input 
          value={filter()} 
          onChange={setFilter}
          placeholder="Search commands..."
        />
        <For each={filteredCommands()}>
          {(cmd, index) => (
            <box
              backgroundColor={index() === selectedIndex() ? theme.theme().primary : undefined}
              onClick={() => handleSelect(cmd)}
            >
              <text>/{cmd.name}</text>
              <text>{cmd.description}</text>
            </box>
          )}
        </For>
      </box>
    </Show>
  );
}
```

#### 2.3.3 InputBox 集成

修改 `InputBox.tsx` 以支持 `/` 触发：

```typescript
export function InputBox() {
  const command = useCommand();
  
  const handleChange = (value: string) => {
    // 检测 / 前缀
    if (value === "/" && !command.isOpen()) {
      command.openPalette();
      return;
    }
    
    // 如果输入以 / 开头，过滤 command palette
    if (value.startsWith("/") && command.isOpen()) {
      // 过滤逻辑
    }
    
    // ... 原有逻辑
  };
  
  const handleSubmit = async () => {
    const content = lastInputValue.trim();
    
    // 检测 command 调用
    if (content.startsWith("/")) {
      const parts = content.slice(1).split(" ");
      const cmdName = parts[0];
      const args = parts.slice(1).join(" ");
      
      const cmd = command.commands().find(c => c.name === cmdName);
      if (cmd) {
        await command.executeCommand(cmdName, args);
        setInput("");
        lastInputValue = "";
        return;
      }
    }
    
    // ... 原有 prompt 逻辑
  };
  
  // ...
}
```

## 3. Echo Command 实现

### 3.1 Server 端

```typescript
// packages/core/src/server/command/built-in/echo.ts

import type { Command, CommandContext, CommandResult } from "../types.js";

export const echoCommand: Command = {
  name: "echo",
  displayName: "Echo",
  description: "Echo a message back (test command)",
  hasArgs: true,
  argsDescription: "message to echo",
  
  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    const message = args.trim() || "Hello from Agent Core!";
    
    return {
      success: true,
      message: `Echoed: ${message}`,
      data: { echoed: message },
    };
  },
};
```

## 4. 初始化流程

### 4.1 Server 启动时注册 Commands

在 `server/index.ts` 或 `server/environment.ts` 中添加：

```typescript
import { CommandRegistry } from "./command/registry.js";
import { echoCommand } from "./command/built-in/echo.js";

// 注册内置 commands
const registry = CommandRegistry.getInstance();
registry.register(echoCommand);

// 未来可以添加更多 built-in commands
// registry.register(sessionCommand);
// registry.register(modelCommand);
```

### 4.2 TUI 启动时加载 Commands

在 `App.tsx` 或 `CommandContext` 初始化时：

```typescript
// 从服务器获取可用 commands
const response = await fetch(`${url}/commands`);
const commands = await response.json();
setCommands(commands);
```

## 5. 文件结构

```
packages/core/src/
├── server/
│   ├── command/
│   │   ├── index.ts           # 导出所有 command 相关类型
│   │   ├── types.ts           # Command 接口定义
│   │   ├── registry.ts        # CommandRegistry 实现
│   │   └── built-in/
│   │       └── echo.ts        # Echo command 实现
│   └── routes/
│       └── commands.ts        # Command HTTP 路由
├── cli/tui/
│   ├── contexts/
│   │   ├── command.tsx        # CommandContext
│   │   └── index.ts           # 导出
│   └── components/
│       └── CommandPalette.tsx # Command 选择器 UI
```

## 6. API 接口

### GET /commands

获取所有可用 commands。

**Response:**
```json
[
  {
    "name": "echo",
    "displayName": "Echo",
    "description": "Echo a message back (test command)",
    "hasArgs": true,
    "argsDescription": "message to echo"
  }
]
```

### POST /commands/:name

执行指定 command。

**Request Body:**
```json
{
  "sessionId": "optional-session-id",
  "args": "command arguments"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Echoed: hello world",
  "data": {
    "echoed": "hello world"
  }
}
```

## 7. 后续扩展方向

1. **更多 Built-in Commands**: /sessions, /models, /agents 等
2. **权限控制**: Command 级别的权限检查
3. **参数校验**: 使用 zod 等工具进行参数 schema 校验
4. **Command History**: 记录 command 执行历史
5. **自定义 Commands**: 允许用户通过配置文件定义 commands
6. **Shortcuts**: 支持快捷键触发 commands

## 8. 验收标准

- [ ] Server 端 `/commands` 路由返回所有可用 commands
- [ ] TUI 输入 `/` 弹出 command palette
- [ ] 支持方向键选择 command，Enter 执行
- [ ] 输入 `/echo hello` 在 TUI 上显示 "Echoed: hello"
- [ ] Command 可在全局或指定 session 中执行
- [ ] HTTP API 正常工作，返回正确的执行结果
