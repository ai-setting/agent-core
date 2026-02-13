# OpenCode 应用配置管理实现说明

本文档面向需要理解 thirdparty/opencode 项目中配置管理实现逻辑的开发者或 Agent。通过阅读本文档及引用的**绝对路径**文件，可以完整掌握配置加载、模型选择存储、优先级等实现细节。

> **路径说明**：本文档中所有文件路径均为绝对路径，基于工作区 `d:\document\zhishitong_workspace\zst_project\tong_work`。若工作区根目录不同，请相应替换路径前缀。

---

## 一、配置目录与路径体系

### 1.1 全局路径定义 (Global.Path)

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\global\index.ts`

OpenCode 使用 [xdg-basedir](https://github.com/sindresorhus/xdg-basedir) 定义应用级目录：

```typescript
// 关键代码片段（约第 2-25 行）
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
const app = "opencode"

const data = path.join(xdgData!, app)
const cache = path.join(xdgCache!, app)
const config = path.join(xdgConfig!, app)
const state = path.join(xdgState!, app)

export namespace Global {
  export const Path = {
    get home() {
      return process.env.OPENCODE_TEST_HOME || os.homedir()
    },
    data,      // 数据目录
    bin: path.join(data, "bin"),
    log: path.join(data, "log"),
    cache,     // 缓存目录
    config,    // 配置文件目录
    state,     // 状态/运行时数据目录
  }
}
```

**典型路径（跨平台）**：

| 目录 | 默认路径 | 含义 |
|------|----------|------|
| `config` | `~/.config/opencode` | 全局配置、opencode.json、opencode.jsonc、config.json |
| `state` | `~/.local/state/opencode` | 运行时状态：model.json、kv.json、prompt-stash.jsonl 等 |
| `data` | `~/.local/share/opencode` | 持久数据：storage、auth、mcp-auth 等 |
| `cache` | `~/.cache/opencode` | 缓存：models.json、node_modules 等 |

**跨平台行为**：xdg-basedir 在未设置 `XDG_*` 环境变量时，会使用 `os.homedir()` 拼接路径作为 fallback（如 `~/.config`、`~/.local/state` 等）。因此 **Windows/macOS 无需设置任何环境变量** 即可正常工作，config/state/data 会自动落在 `%USERPROFILE%\.config\opencode` 等路径下。OpenCode 的 Desktop 应用在 Windows 上会额外设置 `XDG_STATE_HOME`（见 `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\desktop\src-tauri\src\cli.rs` 约第 154-163 行），以将 CLI 状态指向应用数据目录，但用户无需手动配置。

**测试覆盖**：可通过 `OPENCODE_TEST_HOME` 覆盖 `home`，用于测试隔离。

### 1.2 config、state、data 三者的区别

| 目录 | 用途 | 典型内容 |
|------|------|----------|
| **config** | 用户配置、偏好 | 可编辑的 JSON 配置，如 `opencode.json`、`config.json` |
| **state** | 运行时状态 | 应用运行时的临时/会话数据，重启后可能仍需保留 |
| **data** | 持久业务数据 | 与业务强相关的持久数据，通常不由用户手改 |

**更细致的理解**：

- **config**（`~/.config/opencode`）：用户主动配置，如模型、主题、快捷键、providers 等，一般会随用户迁移，可被用户直接编辑。
- **state**（`~/.local/state/opencode`）：由应用自动维护的状态，如最近用过的模型、收藏、prompt 历史、prompt stash，偏向「当前使用习惯/会话」，不是核心业务数据。
- **data**（`~/.local/share/opencode`）：与业务和功能相关的持久数据，如认证（`auth.json`）、MCP 认证、session/message 存储、worktree 等，数据量和结构较复杂，通常由代码读写，用户不直接改。

**通俗类比**：

- **config** ≈ 设置文件
- **state** ≈ 缓存/历史记录
- **data** ≈ 应用数据库目录

### 1.3 xdg-basedir 与 OpenCode 的职责划分

**重要**：xdg-basedir 仅提供**路径**，不负责配置层级与合并逻辑。

| 组件 | 职责 |
|------|------|
| **xdg-basedir** | 返回 `~/.config`、`~/.local/share`、`~/.local/state`、`~/.cache` 等目录路径，本身不做配置加载、合并或层级管理 |
| **OpenCode** | 在多层级配置、加载顺序、合并策略、优先级等方面完全自主实现 |

多层级配置（Remote → Global → Project → .opencode → Managed 等）及合并逻辑均在 `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\config\config.ts` 中实现。xdg-basedir 仅提供 `Global.Path.config` 等路径，作为其中一个配置来源。

---

## 二、多层级配置实现方案

### 2.1 概述与优先级总览

**实现文件**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\config\config.ts`

配置通过 `Config.state` 和 `Config.get()` 加载，各层级按优先级从低到高依次合并，得到最终配置：

| 优先级 | 层级 | 来源 | 触发条件 |
|--------|------|------|----------|
| 1（最低） | Remote | `{provider}/.well-known/opencode` | `auth.json` 中存在 `type: "wellknown"` 的 provider |
| 2 | Global | `~/.config/opencode/` | 始终加载 |
| 3 | Custom | `OPENCODE_CONFIG` 指向的文件 | 环境变量存在 |
| 4 | Project | 项目内 `opencode.json{,c}` | `OPENCODE_DISABLE_PROJECT_CONFIG ≠ true` |
| 5 | .opencode 目录 | 各 `.opencode/` 下的 JSON 及 agents/commands/plugins | 见 2.2.5 |
| 6 | Inline | `OPENCODE_CONFIG_CONTENT` | 环境变量存在 |
| 7（最高） | Managed | 系统级目录 | 目录存在时加载 |

### 2.2 各层级实现细节

#### 2.2.1 Remote（组织远程）

- **触发**：`Auth.all()` 中某 provider 的 `type === "wellknown"`（如企业 GitHub）。
- **读取**：`fetch({key}/.well-known/opencode)`，解析返回 JSON 的 `config` 字段。
- **实现**：约第 74-91 行，遍历 `auth` 中 wellknown 项并合并。
- **Auth 文件**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\auth\index.ts`

#### 2.2.2 Global（全局）

- **路径**：`Global.Path.config`（`~/.config/opencode`）。
- **文件顺序**：`config.json` → `opencode.json` → `opencode.jsonc`，依次 `mergeDeep`。
- **实现**：`Config.global()` 惰性函数，约第 1151-1178 行。
- **写入**：`globalConfigFile()` 返回第一个存在的文件，或默认 `opencode.jsonc`。

#### 2.2.3 Custom（自定义文件）

- **触发**：`Flag.OPENCODE_CONFIG`（`process.env.OPENCODE_CONFIG`）。
- **读取**：`loadFile(Flag.OPENCODE_CONFIG)`。
- **实现**：约第 98-101 行。

#### 2.2.4 Project（项目）

- **查找**：`Filesystem.findUp("opencode.jsonc"|"opencode.json", Instance.directory, Instance.worktree)`。
- **参数**：
  - `Instance.directory`：当前工作目录（cwd）
  - `Instance.worktree`：git 根目录（由 `Project.fromDirectory` 决定）
- **合并顺序**：`found.toReversed()`，即从 worktree 根到 cwd，**靠近 cwd 的配置覆盖更上层的**。
- **示例**：`/repo/opencode.json` 与 `/repo/src/opencode.json` 同时存在时，`/repo/src/opencode.json` 优先生效。
- **实现**：约第 104-111 行。
- **关闭**：`OPENCODE_DISABLE_PROJECT_CONFIG=true` 时跳过。
- **Project 逻辑**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\project\project.ts`

#### 2.2.5 .opencode 目录（多目录）

- **目录来源**（`directories` 数组）：
  1. `Global.Path.config`（`~/.config/opencode`）
  2. 项目 `.opencode`：`Filesystem.up({ targets: [".opencode"], start: Instance.directory, stop: Instance.worktree })`
  3. 用户 `~/.opencode`：`Filesystem.up({ targets: [".opencode"], start: Global.Path.home, stop: Global.Path.home })`
  4. 可选：`OPENCODE_CONFIG_DIR`（追加到末尾）

- **每个目录加载**：
  - JSON：`opencode.jsonc`、`opencode.json`（仅对以 `.opencode` 结尾或等于 `OPENCODE_CONFIG_DIR` 的目录）
  - 非 JSON：`command/`、`commands/`、`agent/`、`agents/`、`mode/`、`modes/`、`plugin/`、`plugins/` 下的 `.md`、`.ts`、`.js`

- **合并逻辑**：按 `directories` 顺序迭代，后加载覆盖前加载；`command`、`agent` 用 `mergeDeep`，`plugin` 用 `push` + `deduplicatePlugins`。
- **实现**：约第 117-166 行。
- **Filesystem**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\util\filesystem.ts`

#### 2.2.6 Inline（内联）

- **触发**：`Flag.OPENCODE_CONFIG_CONTENT`（`process.env.OPENCODE_CONFIG_CONTENT`）。
- **读取**：`JSON.parse(Flag.OPENCODE_CONFIG_CONTENT)`。
- **实现**：约第 168-172 行。

#### 2.2.7 Managed（企业托管）

- **路径**（按平台）：
  - Linux：`/etc/opencode`
  - macOS：`/Library/Application Support/opencode`
  - Windows：`%ProgramData%\opencode`（`C:\ProgramData\opencode`）
- **覆盖**：仅加载 `opencode.jsonc`、`opencode.json`，不安装依赖、不加载 plugins。
- **实现**：`getManagedConfigDir()` 约第 36-47 行，加载约第 174-182 行。
- **测试**：`OPENCODE_TEST_MANAGED_CONFIG_DIR` 可覆盖路径。

### 2.3 合并策略

- **普通字段**：`mergeDeep`（remeda），后加载覆盖先加载。
- **数组字段**（`mergeConfigConcatArrays`）：
  - `plugin`：`[...target, ...source]` 去重。
  - `instructions`：同上。
- **后处理**：`mode` 迁移到 `agent`、`tools` 迁移到 `permission`、`autoshare` 迁移到 `share` 等（约第 183-228 行）。

### 2.4 配置读取与整合流程

```
1. 初始化 result = {}
2. 遍历 wellknown auth，fetch 各 provider 的 .well-known/opencode，merge 到 result
3. result = merge(result, await Config.global())
4. 若 OPENCODE_CONFIG 存在，result = merge(result, loadFile(OPENCODE_CONFIG))
5. 若未禁用项目配置，findUp 项目内 opencode.json，按根→叶顺序 merge 到 result
6. 构建 directories，遍历每个 .opencode 目录，加载 JSON 及 agents/commands/plugins，merge 到 result
7. 若 OPENCODE_CONFIG_CONTENT 存在，result = merge(result, JSON.parse(...))
8. 若 managed 目录存在，merge 其下的 opencode.json{,c} 到 result
9. 后处理（mode→agent、tools→permission 等）
10. 返回 result 作为最终 Config.Info
```

**入口**：`Config.state` 的 `Instance.state` 回调（约第 63-234 行）。`Config.get()` 返回 `state().then(x => x.config)`。

### 2.5 全局配置文件候选（补充）

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\config\config.ts`

`globalConfigFile()`（约第 944-950 行）返回第一个存在的文件，或默认 `opencode.jsonc`：

```typescript
const candidates = [
  path.join(Global.Path.config, "opencode.jsonc"),
  path.join(Global.Path.config, "opencode.json"),
  path.join(Global.Path.config, "config.json"),
]
```

`Config.global` 加载顺序（约第 1152-1158 行）：`config.json` → `opencode.json` → `opencode.jsonc`。

### 2.6 配置中的模型相关字段

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\config\config.ts`

`Config.Info` 中与模型相关的字段（约第 703-713 行）：

```typescript
model: z.string().optional(),        // 默认模型，格式 provider/model
small_model: z.string().optional(),  // 轻量任务用模型
default_agent: z.string().optional(), // 默认 agent
```

### 2.7 相关环境变量

**Flag 定义**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\flag\flag.ts`

| 变量 | 作用 |
|------|------|
| `OPENCODE_CONFIG` | 指定单个 JSON 配置文件路径 |
| `OPENCODE_CONFIG_DIR` | 指定 .opencode 风格目录，追加到 directories 末尾 |
| `OPENCODE_CONFIG_CONTENT` | 内联 JSON 字符串 |
| `OPENCODE_DISABLE_PROJECT_CONFIG` | 禁用项目级配置 |
| `OPENCODE_PERMISSION` | JSON 字符串，覆盖 permission |
| `OPENCODE_TEST_MANAGED_CONFIG_DIR` | 测试时覆盖 managed 目录路径 |

---

## 三、模型选择存储（无 Session 场景）

模型选择可在没有 Session 的情况下完成，存储方式因运行环境不同而不同。

### 3.1 TUI/CLI 模式

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\local.tsx`

#### 3.1.1 存储文件

**绝对路径**：`{Global.Path.state}/model.json`

即 `~/.local/state/opencode/model.json`（Linux/macOS）。

**文件内容结构**（约第 120-139 行）：

```typescript
{
  recent: { providerID: string; modelID: string }[],
  favorite: { providerID: string; modelID: string }[],
  variant: Record<string, string | undefined>
}
```

- `recent`：最近使用的模型列表（最多 10 个）
- `favorite`：收藏模型
- `variant`：每个模型的变体选择（如 reasoning 等）

**重要**：当前选中的模型（`model`）**没有**持久化到 `model.json`，仅保存在内存中。重启后通过以下 fallback 顺序恢复：

1. 命令行参数 `--model`
2. `sync.data.config.model`（全局/项目配置）
3. `modelStore.recent` 中第一个有效模型
4. provider 默认模型

#### 3.1.2 关键实现

**读取 model.json**（约第 141-153 行）：

```typescript
const file = Bun.file(path.join(Global.Path.state, "model.json"))
file.json()
  .then((x) => {
    if (Array.isArray(x.recent)) setModelStore("recent", x.recent)
    if (Array.isArray(x.favorite)) setModelStore("favorite", x.favorite)
    if (typeof x.variant === "object" && x.variant !== null) setModelStore("variant", x.variant)
  })
  .catch(() => {})
  .finally(() => {
    setModelStore("ready", true)
    if (state.pending) save()
  })
```

**写入 model.json**（约第 126-139 行）：

```typescript
function save() {
  if (!modelStore.ready) {
    state.pending = true
    return
  }
  state.pending = false
  Bun.write(
    file,
    JSON.stringify({
      recent: modelStore.recent,
      favorite: modelStore.favorite,
      variant: modelStore.variant,
    }),
  )
}
```

`save()` 在以下场景被调用：

- `cycleFavorite` 选择收藏模型
- `toggleFavorite` 切换收藏
- `variant.set` 设置模型变体

注意：`model.set(..., { recent: true })` 时仅更新内存中的 `recent`，不会调用 `save()`，因此通过模型选择对话框加入的 recent 列表在本次会话结束后不会持久化到 `model.json`。

### 3.2 Web/Desktop App 模式

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\app\src\context\models.tsx`

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\app\src\utils\persist.ts`

Web/Desktop 使用 `Persist.global` + `persisted` 持久化模型相关状态。

#### 3.2.1 存储键与格式

```typescript
// models.tsx 约第 24-30 行
const [store, setStore, _, ready] = persisted(
  Persist.global("model", ["model.v1"]),
  createStore<Store>({
    user: [],    // 模型可见性、收藏等
    recent: [],  // 最近使用的模型
    variant: {}, // 模型变体
  }),
)
```

- 存储键：`model`（在 `opencode.global.dat` 命名空间下）
- 兼容旧键：`model.v1`

#### 3.2.2 存储后端

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\app\src\utils\persist.ts`

- Web：`localStorage`，前缀 `opencode.global.dat:`
- Desktop：`platform.storage`（通常为 IndexedDB 或类似持久化）

---

## 四、配置更新 API

### 4.1 项目级配置更新

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\config\config.ts`

```typescript
// 约第 966-971 行
export async function update(config: Info) {
  const filepath = path.join(Instance.directory, "config.json")
  const existing = await loadFile(filepath)
  await Bun.write(filepath, JSON.stringify(mergeDeep(existing, config), null, 2))
  await Instance.dispose()
}
```

写入的是**项目目录**下的 `config.json`，不是全局配置。

### 4.2 全局配置更新

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\config\config.ts`

```typescript
// 约第 1010-1052 行
export async function updateGlobal(config: Info) {
  const filepath = globalConfigFile()
  const before = await Bun.file(filepath).text().catch(...)
  // 合并并写入，支持 JSONC patch
  const next = await (async () => {
    if (!filepath.endsWith(".jsonc")) {
      const existing = parseConfig(before, filepath)
      const merged = mergeDeep(existing, config)
      await Bun.write(filepath, JSON.stringify(merged, null, 2))
      return merged
    }
    const updated = patchJsonc(before, config)
    const merged = parseConfig(updated, filepath)
    await Bun.write(filepath, updated)
    return merged
  })()
  global.reset()
  void Instance.disposeAll().catch(...)
  return next
}
```

### 4.3 HTTP API

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\server\routes\config.ts`

- `GET /config`：获取当前合并后的配置（`Config.get()`）
- `PATCH /config`：更新项目配置（`Config.update()`）

**文件路径**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\server\routes\global.ts`

- `GET /global/config`：获取全局配置（`Config.getGlobal()`）
- `PATCH /global/config`：更新全局配置（`Config.updateGlobal()`）

---

## 五、其他相关存储位置

| 用途 | 路径/键 | 实现文件（绝对路径） |
|------|---------|----------------------|
| 认证 | `Global.Path.data/auth.json` | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\auth\index.ts` |
| MCP 认证 | `Global.Path.data/mcp-auth.json` | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\mcp\auth.ts` |
| 模型元数据缓存 | `Global.Path.cache/models.json` | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\provider\models.ts` |
| Session/Message 存储 | `Global.Path.data/storage/` | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\storage\storage.ts` |
| TUI 键值 | `Global.Path.state/kv.json` | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\kv.tsx` |
| 提示历史 | `Global.Path.state/prompt-history.jsonl` | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\history.tsx` |
| 提示暂存 | `Global.Path.state/prompt-stash.jsonl` | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\component\prompt\stash.tsx` |

---

## 六、快速索引：按用途查找

| 需求 | 建议阅读（绝对路径） |
|------|----------------------|
| 全局路径定义 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\global\index.ts` |
| 多层级配置实现 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\config\config.ts`（约 62-234, 1152-1175 行） |
| Instance / Project 与 worktree | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\project\instance.ts`、`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\project\project.ts` |
| 目录遍历 (findUp, up) | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\util\filesystem.ts` |
| 环境变量 Flag | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\flag\flag.ts` |
| TUI 模型选择与持久化 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\local.tsx`（约 94-364 行） |
| Web 模型状态持久化 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\app\src\context\models.tsx`、`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\app\src\utils\persist.ts` |
| 配置 HTTP API | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\server\routes\config.ts`、`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\server\routes\global.ts` |
| 同步与 Config 来源 | `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\sync.tsx`（bootstrap 拉取 config） |

---

## 七、配置读取与使用示例

### 7.1 服务端（Node/Bun）读取配置

**引入**：从 `@/config/config` 或 `d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\config\config.ts` 导入 `Config`。

#### 读取完整合并后的配置

```typescript
import { Config } from "@/config/config"

// 获取当前工作区下合并后的配置（含全局、项目、.opencode 等）
const config = await Config.get()

// 读取常用字段
console.log(config.model)           // 默认模型，如 "anthropic/claude-sonnet-4-5"
console.log(config.theme)           // 主题
console.log(config.instructions)    // 额外指令文件路径
console.log(config.provider)        // 自定义 provider 配置
console.log(config.agent)           // agent 配置
```

#### 仅读取全局配置（不含项目覆盖）

```typescript
const globalConfig = await Config.getGlobal()
```

#### 获取配置目录列表（用于加载 agents、commands、plugins）

```typescript
const directories = await Config.directories()
// 返回 [Global.Path.config, 项目 .opencode, ~/.opencode, ...]
```

#### 实际使用示例（来自代码库）

```typescript
// provider 中检查 opencode apiKey：d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\provider\provider.ts
const config = await Config.get()
if (config.provider?.["opencode"]?.options?.apiKey) return true

// session instruction 中读取 instructions：d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\session\instruction.ts
const config = await Config.get()
if (config.instructions) {
  for (let instruction of config.instructions) {
    // 解析并加载指令文件
  }
}

// debug config 命令打印完整配置：d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\debug\config.ts
const config = await Config.get()
process.stdout.write(JSON.stringify(config, null, 2) + EOL)
```

### 7.2 通过 HTTP API / SDK 读取配置

OpenCode 服务运行后，可通过 HTTP 或 SDK 获取配置：

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk"

const client = createOpencodeClient({ baseUrl: "http://localhost:..." })

// 获取合并后的配置（含项目覆盖）
const { data: config } = await client.config.get({})

// 获取全局配置（无项目覆盖）
const { data: globalConfig } = await client.global.config.get({})

// 获取 providers 列表及默认模型
const { data: providers } = await client.config.providers({})
// providers.providers: Provider[]
// providers.default: Record<providerID, defaultModelID>

// TUI bootstrap 拉取 config 示例：d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\cli\cmd\tui\context\sync.tsx
const configResponse = await sdk.client.config.get({}, { throwOnError: true })
setStore("config", reconcile(configResponse.data))
```

### 7.3 更新配置

#### 服务端更新

```typescript
// 更新项目配置（写入项目目录 config.json）
await Config.update({ model: "anthropic/claude-sonnet-4-5" })

// 更新全局配置（写入 ~/.config/opencode/opencode.jsonc 等）
await Config.updateGlobal({ theme: "opencode", model: "anthropic/claude-sonnet-4-5" })
```

#### 通过 HTTP API 更新

```typescript
// 更新项目配置（Config 对象作为 body）
await client.config.update({}, { body: { model: "anthropic/claude-sonnet-4-5" } })

// 更新全局配置（参考 d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\app\src\context\global-sync.tsx）
await client.global.config.update({ config: { theme: "opencode", model: "anthropic/claude-sonnet-4-5" } })
```

### 7.4 读取 state 下的模型选择（TUI 本地）

**Global 定义**：`d:\document\zhishitong_workspace\zst_project\tong_work\thirdparty\opencode\packages\opencode\src\global\index.ts`

```typescript
import { Global } from "@/global"
import path from "path"

// model.json 路径
const modelFile = Bun.file(path.join(Global.Path.state, "model.json"))
const data = await modelFile.json().catch(() => ({ recent: [], favorite: [], variant: {} }))

console.log(data.recent)   // 最近使用的模型
console.log(data.favorite) // 收藏的模型
console.log(data.variant)  // 模型变体选择
```

---

## 八、总结

1. **xdg-basedir 与 OpenCode**：xdg-basedir 仅提供 `~/.config`、`~/.local/share` 等路径；多层级配置与合并逻辑均由 OpenCode 在 `config.ts` 中实现。
2. **配置层级**：Remote → Global → Custom → Project → .opencode → Inline → Managed，共 7 层，后加载覆盖先加载。
3. **默认配置目录**：`~/.config/opencode`，支持 `opencode.jsonc`、`opencode.json`、`config.json`。
4. **模型选择持久化**：
   - TUI：`~/.local/state/opencode/model.json`，仅持久化 `recent`、`favorite`、`variant`，当前选中模型不持久化。
   - Web：`localStorage` / 桌面存储，键 `model`，内容包括 `user`、`recent`、`variant`。
5. **默认模型来源**：配置中的 `model` 字段 → `recent` 第一个有效模型 → provider 默认模型。
