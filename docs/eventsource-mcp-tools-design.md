# EventSource MCP Tools 注册功能设计文档

## 1. 背景与目标

### 1.1 当前问题

目前 Agent-Core 有两套 MCP 机制：

| 机制 | 用途 | Tools 注册 |
|------|------|------------|
| 普通 MCP Servers | 提供工具能力 | ✅ 已注册到 Environment |
| EventSource MCP Servers | 接收外部事件 | ❌ 未注册 |

EventSource MCP Server（如 Feishu 事件源）本身也提供工具（如 `send_message`、`reply_message`），但这些工具目前**未被注册**到 Environment，导致 Agent 无法调用它们。

### 1.2 目标

让 EventSource MCP Server 的工具也能像普通 MCP 一样注册到 Environment，使 Agent 可以调用这些工具（如发送飞书消息）。

---

## 2. 现状分析

### 2.1 普通 MCP 机制 (`McpManager`)

```
config.jsonc.mcp.clients
        ↓
McpManager.loadClients()
        ↓
client.listTools() → 获取工具列表
        ↓
convertMcpTool() → 转换为 ToolInfo
        ↓
registerTool() → 注册到 Environment
```

**关键文件：**
- `packages/core/src/env_spec/mcp/manager.ts` - MCP 管理器
- `packages/core/src/env_spec/mcp/convert.ts` - 工具转换（命名空间前缀）
- `packages/core/src/core/environment/base/base-environment.ts` - registerTool()

### 2.2 EventSource 机制 (`EventMcpManager`)

```
config.jsonc.mcp.eventSources
        ↓
EventMcpManager.loadClients()
        ↓
EventMcpClient.connect() → 建立连接
        ↓
接收事件 (Notification / Polling)
        ↓
env.publishEvent() → 发布到事件总线
```

**关键文件：**
- `packages/core/src/server/env_spec/mcp/event-source/manager.ts`
- `packages/core/src/server/env_spec/mcp/event-source/client.ts`

### 2.3 工具命名约定

普通 MCP 工具命名格式：`{MCP服务器名}_{原始工具名}`

示例：
- Feishu EventSource 的 `send_message` → `feishu_send_message`
- Timer EventSource 的 `get_status` → `timer_get_status`

---

## 3. 设计方案

### 3.1 方案 A：扩展 EventMcpManager（推荐）

**核心思路：** 在 `EventMcpManager` 中复用 `McpManager` 的工具转换逻辑。

```typescript
// packages/core/src/server/env_spec/mcp/event-source/manager.ts

class EventMcpManager {
  private tools: Map<string, ToolInfo> = new Map();
  
  async loadClients(mcpClientsConfig, eventSourceConfig) {
    // 现有逻辑：创建 EventMcpClient
    
    // 新增：获取并注册工具
    const toolsResult = await client.listTools();
    for (const mcpTool of toolsResult.tools || []) {
      const toolInfo = convertMcpTool(mcpTool, client, sourceName, {
        prefix: sourceName  // 使用 EventSource 配置名作为前缀
      });
      this.tools.set(toolInfo.name, toolInfo);
    }
  }
  
  // 新增：获取所有已注册工具
  getTools(): ToolInfo[] {
    return Array.from(this.tools.values());
  }
}
```

### 3.2 方案 B：统一管理器

创建更高层的抽象，同时管理普通 MCP 和 EventSource MCP。

**复杂度较高，暂不推荐。**

---

## 4. 详细设计

### 4.1 修改 EventMcpManager

**文件：** `packages/core/src/server/env_spec/mcp/event-source/manager.ts`

```typescript
import { convertMcpTool } from "../../../env_spec/mcp/convert.js";
import type { ToolInfo } from "../../../env_spec/mcp/types.js";

export class EventMcpManager {
  private tools: Map<string, ToolInfo> = new Map();
  
  // 现有方法...
  
  /**
   * 注册 MCP 工具
   */
  private async registerMcpTools(
    client: any, 
    sourceName: string,
    options?: { prefix?: string }
  ): Promise<void> {
    try {
      const toolsResult = await client.listTools();
      const mcpTools = toolsResult.tools || [];
      
      for (const mcpTool of mcpTools) {
        const toolInfo = convertMcpTool(
          mcpTool, 
          client, 
          sourceName, 
          { prefix: options?.prefix || sourceName }
        );
        this.tools.set(toolInfo.name, toolInfo);
      }
      
      console.error(`[EventMcpManager] Registered ${mcpTools.length} tools from ${sourceName}`);
    } catch (error) {
      console.error(`[EventMcpManager] Failed to register tools from ${sourceName}:`, error);
    }
  }
  
  /**
   * 获取所有已注册的工具
   */
  getTools(): ToolInfo[] {
    return Array.from(this.tools.values());
  }
  
  /**
   * 断开连接时清理工具
   */
  async disconnectClient(sourceName: string): Promise<void> {
    // 清理该源的所有工具
    const prefix = `${sourceName}_`;
    for (const toolName of this.tools.keys()) {
      if (toolName.startsWith(prefix)) {
        this.tools.delete(toolName);
      }
    }
  }
}
```

### 4.2 修改 ServerEnvironment

**文件：** `packages/core/src/server/environment.ts`

在 `initEventSources()` 中注册工具：

```typescript
private async initEventSources(): Promise<void> {
  // 现有逻辑...
  
  await this.eventMcpManager.loadClients(mcpClients, eventSourcesConfig);
  
  // 新增：注册 EventSource MCP 工具
  const eventSourceTools = this.eventMcpManager.getTools();
  for (const tool of eventSourceTools) {
    this.registerTool(tool);
  }
}
```

### 4.3 工具命名配置

在 `config.jsonc` 中支持配置工具前缀：

```jsonc
{
  "mcp": {
    "eventSources": {
      "sources": {
        "feishu": {
          "name": "feishu",
          "options": {
            "eventTypes": ["im.message.received"],
            "registerTools": true,  // 是否注册工具
            "toolPrefix": "feishu"   // 可选：自定义前缀
          }
        }
      }
    }
  }
}
```

---

## 5. 实现步骤

### Phase 1: 基础功能

1. **修改 EventMcpManager**
   - 添加 `tools` Map 存储
   - 添加 `registerMcpTools()` 方法
   - 修改 `loadClients()` 在连接后调用工具注册
   - 添加 `getTools()` 方法

2. **修改 ServerEnvironment**
   - 在 `initEventSources()` 后调用 `getTools()` 并注册到 Environment

### Phase 2: 配置增强

3. **添加配置支持**
   - 支持 `registerTools: boolean`
   - 支持 `toolPrefix: string`

4. **完善错误处理**
   - 工具注册失败时不影响事件接收
   - 添加日志记录

### Phase 3: 清理与测试

5. **断开时清理**
   - 实现 `disconnectClient()` 清理工具

6. **测试验证**
   - 单元测试：EventMcpManager 工具注册
   - 集成测试：Feishu `send_message` 工具可用

---

## 6. 影响的文件

| 文件 | 改动 |
|------|------|
| `packages/core/src/server/env_spec/mcp/event-source/manager.ts` | 添加工具注册逻辑 |
| `packages/core/src/server/environment.ts` | 注册 EventSource 工具到 Environment |
| `packages/core/src/core/types/env-event.ts` | （可选）扩展事件类型 |

---

## 7. 风险与注意事项

1. **工具冲突**：多个 EventSource 同名工具问题 → 通过前缀解决
2. **启动顺序**：EventSource 工具需要在 Agent 初始化前注册 → 在 `loadFromConfig()` 中确保顺序
3. **错误隔离**：工具注册失败不应影响事件接收 → try-catch 包裹
4. **类型兼容**：确保 `convertMcpTool()` 能处理 EventMcpClient
