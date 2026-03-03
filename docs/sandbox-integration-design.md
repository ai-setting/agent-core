# Agent Core 沙箱配置接入实现方案

> 版本：v1.0  
> 日期：2026-03-03  
> 状态：待评审

---

## 一、背景与目标

### 1.1 背景

参考 [anthropic-experimental/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)（3249 ⭐）项目，agent-core 需要接入沙箱能力来增强安全性：

- **问题**：Agent 在 handle_action 执行工具时直接运行在主机上，拥有全部文件系统和网络访问权限
- **风险**：恶意工具可能窃取 SSH keys、AWS credentials，或外发敏感数据
- **需求**：在 Environment 级别配置沙箱策略，通过 action name 过滤，只对特定工具启用沙箱

### 1.2 目标

1. 在 Environment 配置中添加 `sandbox` 配置项，支持：
   - 启用/禁用沙箱
   - action name 过滤（只有匹配的 action 才经过沙箱）
   - 文件系统限制（denyRead / allowWrite / denyWrite）
   - 网络限制（allowedDomains / deniedDomains）
2. **统一拦截点**：在 `BaseEnvironment.handle_action()` 入口处统一处理
3. **TDD 优先**：先编写测试用例，验证开启/关闭场景

---

## 二、配置设计

### 2.1 Schema 定义

在 `packages/core/src/config/types.ts` 的 `ConfigInfo` 中新增：

```typescript
// 沙箱类型
const SandboxType = z.enum(["native", "docker"]).default("native").describe(
  "Sandbox type: 'native' uses OS-level sandboxing (bubblewrap on Linux, sandbox-exec on macOS), 'docker' uses Docker containers"
);

// 沙箱配置 Schema
const SandboxFilesystemConfig = z.object({
  denyRead: z.array(z.string()).optional().describe("Paths denied for reading"),
  allowWrite: z.array(z.string()).optional().describe("Paths allowed for writing"),
  denyWrite: z.array(z.string()).optional().describe("Paths denied for writing"),
});

const SandboxNetworkConfig = z.object({
  allowedDomains: z.array(z.string()).optional().describe("Allowed domain patterns (e.g., 'github.com', '*.npmjs.org')"),
  deniedDomains: z.array(z.string()).optional().describe("Denied domain patterns"),
});

// Docker 沙箱配置（未来扩展）
const SandboxDockerConfig = z.object({
  image: z.string().optional().describe("Docker image to use"),
  networkMode: z.enum(["bridge", "host", "none"]).optional().describe("Docker network mode"),
  volumes: z.record(z.string(), z.string()).optional().describe("Volume mappings"),
});

// 沙箱动作过滤配置
const SandboxActionFilterConfig = z.object({
  include: z.array(z.string()).optional().describe("Action names to include in sandbox (e.g., ['bash', 'mcp_*'])"),
  exclude: z.array(z.string()).optional().describe("Action names to exclude from sandbox"),
});

// 主配置 Schema 中新增
const SandboxConfig = z.object({
  enabled: z.boolean().optional().default(false).describe("Enable sandbox for this environment"),
  type: SandboxType.optional().describe("Sandbox implementation type"),
  actionFilter: SandboxActionFilterConfig.optional().describe("Filter which actions to sandbox"),
  filesystem: SandboxFilesystemConfig.optional().describe("Filesystem restrictions"),
  network: SandboxNetworkConfig.optional().describe("Network restrictions"),
  docker: SandboxDockerConfig.optional().describe("Docker-specific configuration (when type is 'docker')"),
});
```

### 2.2 配置示例

**Global 配置** (`~/.config/tong_work/agent-core/tong_work.jsonc`)：

```jsonc
{
  "activeEnvironment": "os_env",
  
  // 沙箱配置（全局生效）
  "sandbox": {
    "enabled": true,
    "type": "native",  // 或 "docker"（未来支持）
    
    // 动作过滤：只有匹配的 action 才经过沙箱
    "actionFilter": {
      "include": ["bash", "mcp_*", "filesystem_*"],
      "exclude": ["bash_read_only"]
    },
    
    // 文件系统限制
    "filesystem": {
      "denyRead": ["~/.ssh", "~/.aws", "~/.kube"],
      "allowWrite": [".", "/tmp"],
      "denyWrite": [".env", "~/.aws"]
    },
    
    // 网络限制
    "network": {
      "allowedDomains": ["github.com", "*.npmjs.org"],
      "deniedDomains": []
    },
    
    // Docker 配置（未来支持）
    "docker": {
      "image": "agent-core-sandbox:latest",
      "networkMode": "bridge",
      "volumes": {
        "/project": "/workspace"
      }
    }
  }
}
```

**匹配规则**：
- `include` 为空或省略：默认所有 action 都经过沙箱（当 enabled: true 时）
- `include` 有值：只有匹配的 action 才经过沙箱
- `exclude` 有值：排除匹配的 action
- 支持通配符 `*` 匹配任意字符

### 2.3 配置优先级

```
Global sandbox 配置
    ↓ 被 Environment 覆盖
Environment sandbox 配置
    ↓ 被命令行参数覆盖（未来）
```

### 2.4 Action 过滤匹配规则

| 配置 | 行为 |
|------|------|
| `include: []` 或省略 | 所有 action 都经过沙箱 |
| `include: ["bash", "mcp_*"]` | 只有 bash 和以 mcp_ 开头的 action 经过沙箱 |
| `exclude: ["bash_readonly"]` | 排除 bash_readonly，其他经过沙箱 |
| `include: ["*"], exclude: ["safe_*"]` | 所有 action 除了 safe_ 开头的都经过沙箱 |

---

## 三、沙箱加载逻辑

### 3.1 沙箱抽象层设计

为支持扩展性，引入沙箱抽象层：

```
packages/core/src/core/sandbox/
├── index.ts                      # 导出入口
├── types.ts                      # 沙箱类型定义与抽象接口
├── sandbox-factory.ts            # 沙箱工厂（根据配置创建实例）
├── sandbox-action-filter.ts      # Action 过滤匹配逻辑
├── implementations/
│   ├── native-sandbox.ts         # 原生沙箱（bubblewrap/sandbox-exec）
│   └── docker-sandbox.ts         # Docker 沙箱（未来实现）
└── test/
    └── sandbox-action-filter.test.ts
```

#### 沙箱抽象接口

```typescript
// packages/core/src/core/sandbox/types.ts

import type { SandboxConfig } from "../../config/types.js";

/**
 * 沙箱提供者抽象接口
 * 不同的沙箱实现（native/docker）实现此接口
 */
export interface ISandboxProvider {
  /** 沙箱类型 */
  readonly type: 'native' | 'docker';
  
  /**
   * 初始化沙箱
   * @param config 沙箱配置
   */
  initialize(config: SandboxConfig): Promise<void>;
  
  /**
   * 检查沙箱是否已初始化
   */
  isInitialized(): boolean;
  
  /**
   * 包装命令，使其在沙箱中执行
   * @param command 原始命令
   * @returns 包装后的命令
   */
  wrapCommand(command: string): Promise<string>;
  
  /**
   * 检查命令是否需要沙箱包装
   * @param actionName action 名称
   * @param config 沙箱配置
   */
  shouldSandbox(actionName: string, config: SandboxConfig): boolean;
  
  /**
   * 清理沙箱资源
   */
  cleanup(): Promise<void>;
}

/**
 * 沙箱提供者工厂
 */
export interface ISandboxProviderFactory {
  /** 创建沙箱提供者 */
  create(type: 'native' | 'docker'): ISandboxProvider;
}
```

### 3.2 统一拦截点：BaseEnvironment.handle_action()

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent.run() ReAct 循环                    │
│                                                              │
│  ┌─────────────┐                                           │
│  │ 1. invokeLLM│ ← LLM 生成 Tool Calls                    │
│  └──────┬──────┘                                           │
│         │                                                  │
│         ▼                                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 2. BaseEnvironment.handle_action()                   │  │
│  │    ┌─────────────────────────────────────────────┐   │  │
│  │    │ a. 获取沙箱配置                              │   │  │
│  │    │ b. 检查 sandbox.enabled                     │   │  │
│  │    │ c. 使用 factory 创建沙箱提供者               │   │  │
│  │    │ d. 检查 action name 是否匹配 actionFilter   │   │  │
│  │    │ e. 如果匹配 → provider.wrapCommand()        │   │  │
│  │    │ f. 如果不匹配 → 直接执行                    │   │  │
│  │    └─────────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────┘  │
│         │                                                  │
│         ▼                                                  │
│    (回到步骤 1)                                            │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 BaseEnvironment.handle_action 修改

修改 `packages/core/src/core/environment/base/base-environment.ts`：

```typescript
import { SandboxProviderFactory } from '../../sandbox/sandbox-factory.js'
import { matchActionFilter } from '../../sandbox/sandbox-action-filter.js'
import type { ISandboxProvider } from '../../sandbox/types.js'

class BaseEnvironment {
  private sandboxProvider: ISandboxProvider | null = null
  
  async handle_action(action: Action, context?: Context): Promise<ToolResult> {
    // 获取沙箱配置
    const sandboxConfig = this.getSandboxConfig()
    
    // 检查是否需要沙箱
    if (!this.shouldUseSandbox(action.tool_name, sandboxConfig)) {
      // 不经过沙箱，直接执行
      return this.executeAction(action, context)
    }
    
    // 获取或创建沙箱提供者
    const provider = await this.getSandboxProvider(sandboxConfig)
    
    // 包装命令并执行
    const wrappedCommand = await provider.wrapCommand(
      this.buildActionCommand(action.tool_name, action.args)
    )
    
    return this.executeSandboxed(wrappedCommand, action, context)
  }
  
  private shouldUseSandbox(toolName: string, config?: SandboxConfig): boolean {
    if (!config?.enabled) {
      return false
    }
    
    // 使用 action filter 匹配
    return matchActionFilter(toolName, config.actionFilter)
  }
  
  private async getSandboxProvider(config: SandboxConfig): Promise<ISandboxProvider> {
    if (!this.sandboxProvider) {
      // 使用工厂创建沙箱提供者
      this.sandboxProvider = SandboxProviderFactory.create(config.type ?? 'native')
      
      // 初始化沙箱
      await this.sandboxProvider.initialize(config)
    }
    
    return this.sandboxProvider
  }
}
```

### 3.4 沙箱工厂实现

```typescript
// packages/core/src/core/sandbox/sandbox-factory.ts

import type { ISandboxProvider, ISandboxProviderFactory } from './types.js'
import { NativeSandboxProvider } from './implementations/native-sandbox.js'

class SandboxProviderFactoryImpl implements ISandboxProviderFactory {
  create(type: 'native' | 'docker'): ISandboxProvider {
    switch (type) {
      case 'native':
        return new NativeSandboxProvider()
      case 'docker':
        // TODO: 实现 Docker 沙箱
        throw new Error('Docker sandbox not yet implemented')
      default:
        throw new Error(`Unknown sandbox type: ${type}`)
    }
  }
}

export const SandboxProviderFactory: ISandboxProviderFactory = new SandboxProviderFactoryImpl()
```

### 3.5 原生沙箱实现

```typescript
// packages/core/src/core/sandbox/implementations/native-sandbox.ts

import { SandboxManager } from '@anthropic-ai/sandbox-runtime'
import type { ISandboxProvider } from '../types.js'
import type { SandboxConfig } from '../../../config/types.js'

export class NativeSandboxProvider implements ISandboxProvider {
  readonly type = 'native' as const
  
  async initialize(config: SandboxConfig): Promise<void> {
    if (SandboxManager.isSandboxingEnabled()) {
      return
    }
    
    await SandboxManager.initialize({
      network: {
        allowedDomains: config.network?.allowedDomains ?? [],
        deniedDomains: config.network?.deniedDomains ?? [],
      },
      filesystem: {
        denyRead: config.filesystem?.denyRead ?? [],
        allowWrite: config.filesystem?.allowWrite ?? [],
        denyWrite: config.filesystem?.denyWrite ?? [],
      },
    })
  }
  
  isInitialized(): boolean {
    return SandboxManager.isSandboxingEnabled()
  }
  
  async wrapCommand(command: string): Promise<string> {
    return SandboxManager.wrapWithSandbox(command)
  }
  
  shouldSandbox(actionName: string, config: SandboxConfig): boolean {
    return config.enabled && matchActionFilter(actionName, config.actionFilter)
  }
  
  async cleanup(): Promise<void> {
    await SandboxManager.reset()
  }
}
```

### 3.6 Action 过滤匹配逻辑

```typescript
// packages/core/src/core/sandbox/sandbox-action-filter.ts

interface ActionFilterConfig {
  include?: string[]
  exclude?: string[]
}

/**
 * 匹配 action name 是否应该经过沙箱
 * 
 * 匹配规则：
 * - include 为空：默认所有 action 都匹配
 * - include 有值：必须在 include 中
 * - exclude 有值：不能在 exclude 中
 * - 支持通配符 * 匹配任意字符
 */
export function matchActionFilter(actionName: string, filter?: ActionFilterConfig): boolean {
  // 如果没有配置，默认不经过沙箱
  if (!filter) {
    return false
  }
  
  const { include, exclude } = filter
  
  // 检查 exclude
  if (exclude && exclude.length > 0) {
    for (const pattern of exclude) {
      if (matchGlob(actionName, pattern)) {
        return false  // 被排除
      }
    }
  }
  
  // 检查 include
  if (!include || include.length === 0) {
    return true  // 没有 include 限制，默认匹配所有
  }
  
  for (const pattern of include) {
    if (matchGlob(actionName, pattern)) {
      return true  // 匹配 include
    }
  }
  
  return false  // 不匹配 include
}

/**
 * 通配符匹配
 * * 匹配任意字符
 */
function matchGlob(str: string, pattern: string): boolean {
  if (pattern === '*') {
    return true
  }
  
  // 转换为正则表达式
  const regexPattern = '^' + pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*') + '$'
  
  return new RegExp(regexPattern, 'i').test(str)
}
```

---

## 四、测试用例设计（TDD）

### 4.1 测试文件

新增：
- `packages/core/src/core/sandbox/sandbox-action-filter.test.ts` - Action 过滤匹配测试
- `packages/core/src/core/sandbox/sandbox.test.ts` - 沙箱功能测试
- 修改 `packages/core/src/config/config.test.ts` - 沙箱配置加载测试

### 4.2 Action 过滤匹配测试

```typescript
// packages/core/src/core/sandbox/sandbox-action-filter.test.ts
import { describe, it, expect } from "bun:test";
import { matchActionFilter } from "./sandbox-action-filter.js";

describe("Sandbox Action Filter", () => {
  
  describe("include only", () => {
    it("should match action when include is empty (default all)", () => {
      // 没有配置 include，默认匹配所有
      expect(matchActionFilter("bash", { include: [] })).toBe(true);
      expect(matchActionFilter("any_action", { include: [] })).toBe(true);
    });
    
    it("should match action in include list", () => {
      expect(matchActionFilter("bash", { include: ["bash", "file_read"] })).toBe(true);
      expect(matchActionFilter("file_read", { include: ["bash", "file_read"] })).toBe(true);
    });
    
    it("should not match action not in include list", () => {
      expect(matchActionFilter("http_fetch", { include: ["bash", "file_read"] })).toBe(false);
    });
  });
  
  describe("wildcard matching", () => {
    it("should match wildcard *", () => {
      expect(matchActionFilter("mcp_filesystem_read", { include: ["mcp_*"] })).toBe(true);
      expect(matchActionFilter("mcp_github_push", { include: ["mcp_*"] })).toBe(true);
    });
    
    it("should match multiple wildcards", () => {
      expect(matchActionFilter("bash", { include: ["bash", "mcp_*", "file_*"] })).toBe(true);
      expect(matchActionFilter("mcp_github", { include: ["bash", "mcp_*", "file_*"] })).toBe(true);
      expect(matchActionFilter("file_write", { include: ["bash", "mcp_*", "file_*"] })).toBe(true);
      expect(matchActionFilter("http_fetch", { include: ["bash", "mcp_*", "file_*"] })).toBe(false);
    });
  });
  
  describe("exclude", () => {
    it("should exclude specific actions", () => {
      // 包含所有但排除 bash_readonly
      expect(matchActionFilter("bash_readonly", { exclude: ["bash_readonly"] })).toBe(false);
      expect(matchActionFilter("bash", { exclude: ["bash_readonly"] })).toBe(true);
    });
    
    it("should work with include and exclude", () => {
      const filter = {
        include: ["bash", "mcp_*"],
        exclude: ["mcp_safe"]
      };
      
      expect(matchActionFilter("bash", filter)).toBe(true);
      expect(matchActionFilter("mcp_filesystem", filter)).toBe(true);
      expect(matchActionFilter("mcp_safe", filter)).toBe(false);  // 被排除
    });
  });
  
  describe("no filter config", () => {
    it("should return false when no filter config", () => {
      expect(matchActionFilter("bash", undefined)).toBe(false);
      expect(matchActionFilter("bash", {})).toBe(false);
    });
  });
});
```

### 4.3 沙箱配置加载测试

修改 `packages/core/src/config/config.test.ts`，新增：

```typescript
describe("Sandbox Configuration", () => {
  
  it("should load sandbox config from global config", async () => {
    configRegistry.register(createInlineSource(
      JSON.stringify({
        sandbox: {
          enabled: true,
          actionFilter: {
            include: ["bash", "mcp_*"],
            exclude: ["mcp_safe"]
          },
          filesystem: {
            denyRead: ["~/.ssh"],
            allowWrite: [".", "/tmp"],
          },
          network: {
            allowedDomains: ["github.com"],
          },
        },
      }),
      0
    ));

    const config = await loadConfig();

    expect(config.sandbox).toBeDefined();
    expect(config.sandbox?.enabled).toBe(true);
    expect(config.sandbox?.actionFilter?.include).toContain("bash");
    expect(config.sandbox?.actionFilter?.exclude).toContain("mcp_safe");
    expect(config.sandbox?.filesystem?.denyRead).toContain("~/.ssh");
  });

  it("should default enabled to false when sandbox not configured", async () => {
    configRegistry.register(createInlineSource(
      JSON.stringify({ defaultModel: "gpt-4" }),
      0
    ));

    const config = await loadConfig();
    expect(config.sandbox).toBeUndefined();
  });

  it("should override sandbox config in environment config", async () => {
    // Global: enabled: false
    configRegistry.register(createInlineSource(
      JSON.stringify({ sandbox: { enabled: false } }),
      0
    ));

    // Environment (priority 10): enabled: true
    configRegistry.register(createInlineSource(
      JSON.stringify({
        sandbox: { 
          enabled: true, 
          actionFilter: { include: ["bash"] } 
        } 
      }),
      10
    ));

    const config = await loadConfig();
    expect(config.sandbox?.enabled).toBe(true);
    expect(config.sandbox?.actionFilter?.include).toContain("bash");
  });
});
```

### 4.4 沙箱启用/关闭场景测试

```typescript
describe("Sandbox Toggle Scenarios", () => {
  
  it("should enable sandbox when sandbox.enabled is true and action matches filter", async () => {
    const sandboxConfig = {
      enabled: true,
      actionFilter: { include: ["bash", "mcp_*"] }
    };
    
    // action 在 include 中，应该启用沙箱
    expect(shouldUseSandbox("bash", sandboxConfig)).toBe(true);
    expect(shouldUseSandbox("mcp_filesystem", sandboxConfig)).toBe(true);
  });
  
  it("should disable sandbox when sandbox.enabled is false", async () => {
    const sandboxConfig = {
      enabled: false,
      actionFilter: { include: ["bash"] }
    };
    
    expect(shouldUseSandbox("bash", sandboxConfig)).toBe(false);
  });
  
  it("should not sandbox when action does not match filter", async () => {
    const sandboxConfig = {
      enabled: true,
      actionFilter: { include: ["bash"] }
    };
    
    // http_fetch 不在 include 中，不经过沙箱
    expect(shouldUseSandbox("http_fetch", sandboxConfig)).toBe(false);
  });
});
```

---

## 五、实现计划

### 5.1 阶段划分

| 阶段 | 任务 | 产出 |
|------|------|------|
| **Phase 1** | 更新 Config Schema | `types.ts` 新增 sandbox 配置（含 type、docker） |
| **Phase 2** | 编写测试用例 - Action 过滤 | `sandbox-action-filter.test.ts` |
| **Phase 3** | 编写测试用例 - 配置加载 | `config.test.ts` 新增测试 |
| **Phase 4** | 实现沙箱抽象层 | `sandbox/types.ts`, `sandbox/sandbox-factory.ts` |
| **Phase 5** | 实现原生沙箱 | `sandbox/implementations/native-sandbox.ts` |
| **Phase 6** | 实现 Action 过滤模块 | `sandbox/sandbox-action-filter.ts` |
| **Phase 7** | 修改 BaseEnvironment | `handle_action` 统一拦截 |
| **Phase 8** | 实现 Docker 沙箱（未来） | `sandbox/implementations/docker-sandbox.ts` |
| **Phase 9** | 文档更新 | 配置使用文档 |

### 5.2 关键文件修改清单

| 文件 | 修改类型 | 说明 |
|------|----------|------|
| `config/types.ts` | 新增 | 添加 SandboxConfig Zod Schema（含 type、docker、actionFilter） |
| `config/config.test.ts` | 新增 | 沙箱配置加载测试 |
| `core/sandbox/types.ts` | 新增 | 沙箱抽象接口 ISandboxProvider |
| `core/sandbox/sandbox-factory.ts` | 新增 | 沙箱工厂，根据 type 创建实例 |
| `core/sandbox/sandbox-action-filter.ts` | 新增 | Action 过滤匹配逻辑 |
| `core/sandbox/sandbox-action-filter.test.ts` | 新增 | Action 过滤测试 |
| `core/sandbox/implementations/native-sandbox.ts` | 新增 | 原生沙箱实现（bubblewrap/sandbox-exec） |
| `core/sandbox/implementations/docker-sandbox.ts` | 新增 | Docker 沙箱实现（未来） |
| `core/environment/base/base-environment.ts` | 修改 | `handle_action` 统一拦截 |

---

## 六、配置使用指南

### 6.1 启用沙箱（原生沙箱）

在 `tong_work.jsonc` 中添加：

```jsonc
{
  "sandbox": {
    "enabled": true,
    "type": "native",
    "filesystem": {
      "denyRead": ["~/.ssh", "~/.aws"],
      "allowWrite": ["."],
      "denyWrite": [".env"]
    },
    "network": {
      "allowedDomains": ["github.com", "*.npmjs.org"]
    }
  }
}
```

### 6.2 启用 Docker 沙箱（未来支持）

```jsonc
{
  "sandbox": {
    "enabled": true,
    "type": "docker",
    "docker": {
      "image": "agent-core-sandbox:latest",
      "networkMode": "bridge",
      "volumes": {
        "/project": "/workspace"
      }
    }
  }
}
```

### 6.3 只对特定 action 启用沙箱

```jsonc
{
  "sandbox": {
    "enabled": true,
    "actionFilter": {
      "include": ["bash", "mcp_*", "filesystem_*"],
      "exclude": ["mcp_safe_read"]
    },
    "filesystem": {
      "denyRead": ["~/.ssh"]
    }
  }
}
```

解释：
- `include`: 只有 bash、mcp_xxx、filesystem_xxx 这些 action 才会经过沙箱
- `exclude`: 排除 mcp_safe_read

### 6.4 禁用沙箱

```jsonc
{
  "sandbox": {
    "enabled": false
  }
}
```

### 6.5 环境级别配置

在 `environments/os_env/config.jsonc` 中覆盖：

```jsonc
{
  "sandbox": {
    "enabled": true,
    "actionFilter": {
      "include": ["bash"]
    }
  }
}
```

---

## 七、已知限制

1. **平台支持（原生沙箱）**：仅支持 macOS 和 Linux（Windows 不支持）
2. **依赖项（原生沙箱）**：需要安装 `bubblewrap`（Linux）或系统原生支持（macOS）
3. **Docker 沙箱**：Docker 类型为未来支持，需要 Docker daemon 运行
4. **性能**：首次初始化需要启动代理服务器，有少量开销

---

## 八、扩展性设计

### 8.1 添加新的沙箱类型

要添加新的沙箱类型（如 gvisor、firecracker），只需：

1. 在 `types.ts` 的 `SandboxType` 中添加新类型
2. 在 `sandbox-factory.ts` 中添加 case
3. 实现 `ISandboxProvider` 接口

```typescript
// 新增实现
import type { ISandboxProvider } from './types.ts'

export class GvisorSandboxProvider implements ISandboxProvider {
  readonly type = 'gvisor' as const
  
  async initialize(config: SandboxConfig) {
    // 初始化 gvisor 沙箱
  }
  
  async wrapCommand(command: string): Promise<string> {
    // 包装命令
  }
  
  // ...其他方法
}

// 在工厂中注册
case 'gvisor':
  return new GvisorSandboxProvider()
```

### 8.2 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    BaseEnvironment                          │
│                  handle_action()                            │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              SandboxProviderFactory                         │
│         create(type: 'native' | 'docker' | ...)           │
└───────┬─────────────────────────────────────┬───────────────┘
        │                                     │
        ▼                                     ▼
┌───────────────────┐               ┌───────────────────┐
│  NativeSandbox    │               │  DockerSandbox    │
│  Provider         │               │  Provider         │
│  (bubblewrap/     │               │  (Docker daemon)  │
│   sandbox-exec)   │               │                   │
└───────────────────┘               └───────────────────┘
        │                                     │
        └──────────────┬──────────────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │ ISandboxProvider│
              │ - wrapCommand() │
              │ - initialize()  │
              │ - cleanup()     │
              └─────────────────┘
```

---

## 八、参考文档

- [anthropic-experimental/sandbox-runtime](https://github.com/anthropic-experimental/sandbox-runtime)
- [配置系统设计文档](./config-design.md)
- [配置开发手册](./config-development-guide.md)
- [MCP 实现文档](./mcp-implementation-design.md)

---

**下一步**：等待评审通过后，按照 Phase 1-6 顺序实现。
