# Agent Core CLI 构建计划

## 一、目标

构建一个名为 `tong_work` 的二进制可执行文件，支持：

1. **多平台构建**: Linux, macOS, Windows (x64, ARM64)
2. **多种运行模式**:
   - `tong_work` - 直接运行（自动启动内嵌服务器）
   - `tong_work serve` - 启动 headless 服务器
   - `tong_work attach <url>` - 附加到运行中的服务器
   - `tong_work run <message>` - 直接运行任务
3. **GitHub Actions CI/CD**: 自动化构建和发布

---

## 二、目录结构

```
agent-core/
├── package.json              # 根包配置（Bun workspace）
├── packages/
│   ├── core/              # 核心框架
│   │   ├── src/          # Agent, Session, Tool, Environment
│   │   └── package.json
│   └── app/             # 应用包
│       ├── server/       # HTTP 服务器（被所有应用依赖）
│       │   ├── src/
│       │   └── package.json
│       ├── cli/          # CLI 应用
│       │   ├── src/      # CLI 命令入口
│       │   ├── bin/      # 入口脚本
│       │   ├── scripts/   # 构建脚本
│       │   └── package.json
│       ├── web/          # Web 应用
│       └── desktop/       # 桌面应用
├── scripts/              # 共享构建脚本
├── docs/                 # 文档
├── .github/
│   └── workflows/
│       └── build.yml    # CI/CD 构建
└── README.md
```

---

## 三、依赖关系

```
packages/core/              ← 基础核心，无外部依赖

packages/app/server/       ← 依赖 packages/core
    ↓
packages/app/cli/         ← 依赖 packages/core, packages/app/server
    ↓
packages/app/web/         ← 依赖 packages/app/server
    ↓
packages/app/desktop/      ← 依赖 packages/app/server
```

---

## 四、CLI 命令设计

### 4.1 命令体系

```bash
tong_work [command] [options]

Commands:
  serve     启动 headless 服务器（默认端口 4096）
  attach    附加到运行中的服务器
  run       直接运行代理任务
  version   显示版本信息
  help      显示帮助信息

Global Options:
  --port     指定端口 (默认: 4096)
  --host     指定主机 (默认: localhost)
  --config   配置文件路径
  --help     显示帮助
```

### 4.2 运行模式

#### 模式 1: 直接运行（默认）

```bash
# 直接运行，自动启动内嵌服务器
tong_work "请帮我创建一个 Hello World"

# 等同于：
tong_work serve --port 4096 &
tong_work attach http://localhost:4096
```

#### 模式 2: 独立服务器模式

```bash
# 启动服务器
tong_work serve --port 8080 --host 0.0.0.0

# 指定认证
tong_work serve --port 8080 --password secret
```

#### 模式 3: 附加到现有服务器

```bash
# 附加到远程服务器
tong_work attach http://localhost:4096

# 指定工作目录
tong_work attach http://localhost:4096 --dir /path/to/project

# 继续指定会话
tong_work attach http://localhost:4096 --session <session-id>

# 带认证
tong_work attach http://localhost:4096 --password secret
```

#### 模式 4: 直接任务执行

```bash
# 单次任务执行
tong_work run "请帮我创建一个 Hello World"

# 指定模型
tong_work run "请帮我创建一个 Hello World" --model gpt-4

# 继续会话
tong_work run --continue
```

---

## 五、构建设计

### 5.1 构建目标

| 目标 | OS | Arch | 格式 |
|------|-----|------|------|
| tong_work-linux-x64 | Linux | x64 | ELF |
| tong_work-linux-arm64 | Linux | ARM64 | ELF |
| tong_work-linux-x64-musl | Linux | x64 | ELF (musl) |
| tong_work-darwin-arm64 | macOS | ARM64 | Mach-O |
| tong_work-darwin-x64 | macOS | x64 | Mach-O |
| tong_work-windows-x64 | Windows | x64 | PE |

### 5.2 构建工具

- **运行时**: Bun 1.x
- **构建**: Bun.build
- **打包**: tar.gz (Linux), zip (macOS, Windows)

### 5.3 构建脚本

```bash
# 开发构建
bun run dev

# 全平台构建
bun run build

# 单平台构建
bun run build:single

# Release 构建（打包）
bun run build:release
```

---

## 六、源码结构

```
packages/app/cli/src/
├── index.ts           # CLI 入口 (yargs)
├── commands/
│   ├── serve.ts      # serve 命令
│   ├── attach.ts     # attach 命令
│   ├── run.ts        # run 命令
│   └── version.ts    # version 命令
├── tui.ts            # 终端 UI
├── direct-runner.ts   # 直接运行模式
├── client.ts         # HTTP 客户端
└── cli-engine.ts     # CLI 引擎

packages/app/cli/bin/
└── tong_work         # Shell 入口脚本

packages/app/cli/scripts/
└── build.ts          # 构建脚本
```

---

## 七、CI/CD

GitHub Actions workflow: `.github/workflows/build.yml`

### 触发条件
- Push 到 main/master 分支
- 创建 Release
- 手动触发

### 构建矩阵
- Ubuntu: linux-x64, linux-arm64, linux-x64-musl
- macOS: darwin-x64, darwin-arm64
- Windows: windows-x64

---

## 八、构建产物

```
dist/
├── tong_work-linux-x64/
│   ├── bin/
│   │   └── tong_work
│   └── package.json
├── tong_work-linux-arm64/
│   └── bin/
│       └── tong_work
├── tong_work-darwin-arm64/
│   └── bin/
│       └── tong_work
├── tong_work-windows-x64/
│   ├── bin/
│   │   └── tong_work.exe
│   └── package.json
├── tong_work-linux-x64.tar.gz
├── tong_work-darwin-arm64.zip
└── tong_work-windows-x64.zip
```

---

## 九、参考文档

- [CLI README](../packages/app/cli/README.md)
- [OpenCode 构建体系调研](./OPENCODE_BUILD_SYSTEM.md)
- [二进制构建设计](./BINARY_BUILD.md)
- [Bun.build 文档](https://bun.sh/docs/bundler)
- [yargs 文档](https://yargs.js.org/)
- [Hono 文档](https://hono.dev/)

---

## 十、检查清单

- [x] 目录结构符合设计
- [x] package.json 配置正确
- [x] CLI 命令全部实现
- [x] serve 命令支持认证
- [x] attach 命令支持会话继续
- [ ] 直接运行模式实现
- [x] 构建脚本完成
- [x] GitHub Actions 配置完成
- [ ] 多平台构建测试
- [ ] 构建产物可正常执行
