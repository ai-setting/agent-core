# Environment 相对路径改造方案

## 1. 背景

当前 MCP Server 和 EventSource 的启动命令使用硬编码的绝对路径，导致：
- 无法在不同机器/用户环境下使用
- 无法跨平台运行（Windows/macOS/Linux 路径不同）

## 2. 改造目标

让 env 内部配置使用**相对路径**，由 agent-core 在运行时解析为绝对路径。

## 3. 变量引用规范

| 格式 | 说明 | 示例 |
|------|------|------|
| `${PROJECT_ROOT}` | 环境根目录 | `${PROJECT_ROOT}/mcpservers/xxx` |
| `${ENV_VAR}` | 从环境变量获取 | `${INFO_FEED_API_URL}` |
| `${auth:provider}` | 从 auth.json 获取 | `${auth:openai-api-key}` |

## 4. 实现方案

### 4.1 配置解析层

在 `config/resolver.ts` 中添加路径解析逻辑：

```typescript
interface ResolveOptions {
  projectRoot: string;  // env 根目录
  env: Record<string, string>;  // 环境变量
}

// 解析配置中的路径
function resolveConfigPaths(config: any, options: ResolveOptions): any {
  // 递归遍历配置，解析路径
}
```

### 4.2 MCP Server 启动时路径适配

在 `McpManager` 启动 server 时：

```typescript
// 当前：直接使用配置的 command
const command = config.command;

// 改造后：解析相对路径
const resolvedCommand = resolveCommandWithEnvRoot(
  command, 
  envPath  // 已知的Root env 根目录
);
```

### 4.3 EventSource 路径适配

类似地处理 EventSource 的启动命令。

## 5. 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `config/resolver.ts` | 添加 `resolveConfigPaths` 函数 |
| `env_spec/mcp/manager.ts` | MCP 启动时解析路径 |
| `server/environment.ts` | 传递 env 根目录给 MCPManager |
| `env_spec/mcp/types.ts` | 添加路径解析选项 |

## 6. 实施计划

### Phase 1: 配置解析器改造
- [ ] 添加路径解析函数
- [ ] 支持 `${PROJECT_ROOT}` 变量
- [ ] 支持 `${ENV_VAR}` 变量

### Phase 2: MCP Manager 改造
- [ ] 接收 env 根目录参数
- [ ] 启动前解析 command 路径

### Phase 3: EventSource 改造
- [ ] 类似 MCP 的路径解析

### Phase 4: 测试验证
- [ ] 测试本地 env 的 MCP 启动
- [ ] 测试相对路径解析
