# 可扩展配置实现设计方案

本文档描述一种「简洁默认 + 可扩展」的配置体系设计，适用于需要多层级配置合并、同时希望默认简单、保留扩展能力的场景。

---

## 一、设计目标

1. **默认简单**：仅 Global + Project 两层，易理解、易调试
2. **可扩展**：按需注册额外配置来源，不强制内置所有层级
3. **优先级可控**：通过 `priority` 控制合并顺序，而非写死
4. **可插拔**：企业版、插件、CI 可注入自定义来源
5. **可观测**：每个来源有 `name`，便于排查配置来源

---

## 二、核心抽象：ConfigSource

### 2.1 接口定义

```typescript
interface ConfigSource {
  /** 来源标识，用于日志和排查 */
  name: string
  /** 优先级：低 = 先加载，高 = 后加载（覆盖前者） */
  priority: number
  /** 加载配置，返回 null 表示跳过 */
  load(): Promise<Config.Info | null>
}
```

### 2.2 注册机制

```typescript
const registry: ConfigSource[] = []

function registerSource(source: ConfigSource) {
  registry.push(source)
}

function clearSources() {
  registry.length = 0
}
```

---

## 三、默认实现：仅两层

### 3.1 默认来源

```typescript
const DEFAULT_SOURCES: ConfigSource[] = [
  { name: "global", priority: 0, load: () => loadGlobal() },
  { name: "project", priority: 100, load: () => loadProject() },
]
```

### 3.2 加载流程

```typescript
async function getConfig(): Promise<Config.Info> {
  const sources = [...DEFAULT_SOURCES, ...registry]
    .sort((a, b) => a.priority - b.priority)

  let result: Config.Info = {}
  for (const source of sources) {
    const next = await source.load()
    if (next) {
      result = merge(result, next)
    }
  }
  return postProcess(result)
}
```

---

## 四、扩展来源（可选）

以下来源通过 `registerSource` 按需注册，不参与默认加载。

### 4.1 Remote（组织远程）

```typescript
registerSource({
  name: "remote",
  priority: -100,
  load: async () => {
    const auth = await Auth.all()
    for (const [key, value] of Object.entries(auth)) {
      if (value.type === "wellknown") {
        const res = await fetch(`${key}/.well-known/opencode`)
        const json = await res.json()
        return json.config ?? null
      }
    }
    return null
  },
})
```

### 4.2 Custom（自定义文件）

```typescript
if (process.env.OPENCODE_CONFIG) {
  registerSource({
    name: "custom",
    priority: 50,
    load: () => loadFile(process.env.OPENCODE_CONFIG!),
  })
}
```

### 4.3 Inline（内联 JSON）

```typescript
if (process.env.OPENCODE_CONFIG_CONTENT) {
  registerSource({
    name: "inline",
    priority: 200,
    load: async () => JSON.parse(process.env.OPENCODE_CONFIG_CONTENT!),
  })
}
```

### 4.4 Managed（企业托管）

```typescript
const managedDir = getManagedConfigDir()
if (existsSync(managedDir)) {
  registerSource({
    name: "managed",
    priority: 999,
    load: () => loadFile(path.join(managedDir, "opencode.jsonc")),
  })
}
```

### 4.5 .opencode 目录

可将 .opencode 目录作为独立来源，或并入 project 的 load 逻辑中。

---

## 五、合并策略

### 5.1 普数字段

使用 `mergeDeep`（或类似 deep merge），后加载覆盖先加载的同名字段。

### 5.2 数组字段

- `plugin`：`[...target, ...source]` 去重
- `instructions`：同上

### 5.3 后处理

- `mode` 迁移到 `agent`
- `tools` 迁移到 `permission`
- `autoshare` 迁移到 `share`
- 默认值填充

---

## 六、启用扩展的多种方式

### 6.1 环境变量

```bash
# 启用自定义文件
export OPENCODE_CONFIG=/path/to/config.json

# 启用内联配置
export OPENCODE_CONFIG_CONTENT='{"model":"anthropic/claude-sonnet-4-5"}'
```

### 6.2 配置内声明

```json
{
  "configSources": ["remote", "managed"]
}
```

在 bootstrap 时读取该字段，按需 `registerSource`。

### 6.3 程序化注册

```typescript
// 插件或企业版启动时
ConfigSourceRegistry.register({
  name: "enterprise-policy",
  priority: 500,
  load: () => fetchEnterprisePolicy(),
})
```

---

## 七、与 OpenCode 当前实现的对比

| 维度 | OpenCode 当前 | 本方案 |
|------|---------------|--------|
| 默认层级 | 7 层全部启用 | 仅 2 层（Global + Project） |
| 扩展方式 | 写死在代码中 | `registerSource` 按需注册 |
| 优先级 | 顺序固定 | `priority` 可配置 |
| 可观测性 | 较难追踪来源 | 每个 source 有 `name` |
| 测试友好 | 需 mock 多路径 | 可只注册 mock source |

---

## 八、实现建议

### 8.1 文件组织

```
config/
  source.ts        # ConfigSource 接口与 registry
  sources/
    global.ts      # loadGlobal
    project.ts     # loadProject
    remote.ts      # loadRemote（可选）
    custom.ts      # loadCustom（可选）
    inline.ts      # loadInline（可选）
    managed.ts     # loadManaged（可选）
  merge.ts         # merge + postProcess
  index.ts         # getConfig 入口
```

### 8.2 初始化流程

```typescript
// bootstrap
function initWithDefaults() {
  registry.length = 0
  // 根据环境变量或配置，按需注册扩展来源
  if (env.OPENCODE_CONFIG) registerSource(createCustomSource())
  if (env.OPENCODE_CONFIG_CONTENT) registerSource(createInlineSource())
  if (hasWellKnownAuth()) registerSource(createRemoteSource())
  if (managedDirExists()) registerSource(createManagedSource())
}
```

### 8.3 测试时

```typescript
beforeEach(() => {
  clearSources()
  registerSource({ name: "test", priority: 0, load: () => ({ model: "test/model" }) })
})
```

---

## 九、总结

本方案通过 **ConfigSource 抽象 + 注册机制**，实现：

- 默认只加载 Global + Project，行为简单
- 需要时通过 `registerSource` 扩展，无需改核心逻辑
- 优先级由 `priority` 控制，灵活可调
- 每个来源有独立 `name`，便于日志和排查

可作为新项目配置体系的设计参考，或作为现有配置系统的重构方向。
