# Env MCP Server & Client 示例

这个目录包含演示如何以进程方式启动 Env MCP Server 并通过 Client 调用接口的示例脚本。

## 文件说明

- `env-mcp-server.ts` - Env MCP Server 实现，支持 stdio 和 HTTP 两种模式
- `env-client-test.ts` - 完整的集成测试，演示如何通过 Client 调用 Server 的所有接口

## 启动模式

### 1. Stdio 模式（推荐，MCP 标准）

通过子进程启动 Server，通过 stdin/stdout 进行 JSON-RPC 通信。

```bash
# 运行客户端测试（自动启动 server 子进程）
bun run examples/env-client-test.ts
```

### 2. HTTP 模式

启动 HTTP Server，通过 REST API 进行通信。

```bash
# 手动启动 HTTP Server
bun run examples/env-mcp-server.ts --http

# 或在另一个终端运行客户端测试
bun run examples/env-client-test.ts --http
```

## 支持的接口

Server 实现了完整的 env_spec 协议：

- `env/get_description` - 获取环境描述
- `env/list_profiles` - 列出所有 profiles
- `env/get_profile` - 获取指定 profile
- `env/list_agents` - 列出 agents（支持按 role/profileId 过滤）
- `env/get_agent` - 获取指定 agent
- `env/query_logs` - 查询日志（支持 sessionId/agentId/level/time range/limit 过滤）

## 测试覆盖

`env-client-test.ts` 包含 10 个集成测试：

1. Get Environment Description
2. List Profiles
3. Get Specific Profile
4. List All Agents
5. List Primary Agents Only (filtered)
6. Get Specific Agent
7. Query All Logs
8. Query Logs by Session ID
9. Query Logs by Level
10. Query Logs with Limit

## 架构说明

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Test Script                        │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐         ┌──────────────────────────────┐  │
│  │  EnvClient   │────────▶│     RpcClient (Interface)    │  │
│  └──────────────┘         └──────────────────────────────┘  │
│                                    │                        │
│                    ┌───────────────┴───────────────┐        │
│                    ▼                               ▼        │
│         ┌─────────────────┐            ┌──────────────────┐ │
│         │  StdioRpcClient │            │  HttpRpcClient   │ │
│         │  (Subprocess)   │            │  (HTTP Fetch)    │ │
│         └────────┬────────┘            └────────┬─────────┘ │
│                  │                              │           │
└──────────────────┼──────────────────────────────┼───────────┘
                   │                              │
         ┌─────────▼─────────┐        ┌──────────▼─────────┐
         │   Env MCP Server  │        │   Env MCP Server   │
         │   (stdio mode)    │        │   (http mode)      │
         └───────────────────┘        └────────────────────┘
```

## 自定义扩展

你可以修改 `env-mcp-server.ts` 中的 mock 数据来测试不同的场景：

```typescript
const mockProfiles: EnvProfile[] = [
  // 添加你的自定义 profiles
];

const mockLogs: LogEntry[] = [
  // 添加你的自定义日志
];
```

或者在 `tools` 对象中添加新的方法：

```typescript
const tools: Record<string, (params: any) => any> = {
  // ... 现有方法
  "env/custom_method": (params) => {
    // 你的自定义逻辑
  },
};
```

## 集成到实际项目

1. 将 `env-mcp-server.ts` 作为模板，替换 mock 数据为真实的 Environment 实现
2. 使用 `StdioRpcClient` 或 `HttpRpcClient` 作为基础，实现你的 transport 层
3. 复用 `EnvClient` 类来与 Server 通信
