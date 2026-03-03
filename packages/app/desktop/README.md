# Agent Core Desktop

基于 agent-core 框架的桌面客户端，提供图形化界面的 AI Agent 交互体验。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2.x |
| 前端框架 | Next.js 16 + React 19 |
| UI 组件库 | shadcn/ui + Radix UI |
| 样式 | Tailwind CSS 4 |
| 状态管理 | React Context + useReducer |

## 功能特性

- **会话管理**：创建、切换、删除会话
- **模型选择**：支持多 Provider（OpenAI/Anthropic/DeepSeek）
- **命令面板**：快捷命令执行（Ctrl+P）
- **事件面板**：文件编辑 Diff、命令执行、工具调用展示
- **Markdown 渲染**：代码块、表格、列表等
- **流式响应**：实时打字机效果

## 开发

### 前置依赖

- Node.js 18+
- Bun
- Rust (stable)

### 安装依赖

```bash
cd packages/app/desktop
bun install
```

### 开发模式

```bash
# Terminal 1: 启动 agent-core Server
cd packages/core && bun run start

# Terminal 2: 启动 Desktop App 开发服务器
cd packages/app/desktop
bun run dev
```

访问 http://localhost:3000 预览。

### 构建

```bash
cd packages/app/desktop

# 构建前端
bun run build

# 构建桌面应用（同时完成前端构建和 Tauri 打包）
bun run tauri build
```

构建产物：
- `src-tauri/target/release/agent-core-desktop.exe` - 可执行文件
- `src-tauri/target/release/bundle/msi/Agent Core_1.0.0_x64_en-US.msi` - MSI 安装包
- `src-tauri/target/release/bundle/nsis/Agent Core_1.0.0_x64-setup.exe` - NSIS 安装包

## 目录结构

```
packages/app/desktop/
├── src/
│   ├── app/              # Next.js App Router
│   │   ├── layout.tsx    # 根布局
│   │   ├── page.tsx      # 主页面
│   │   └── globals.css   # 全局样式
│   ├── components/       # UI 组件
│   │   ├── ui/           # shadcn/ui 组件
│   │   ├── session-sidebar.tsx
│   │   ├── chat-area.tsx
│   │   ├── top-toolbar.tsx
│   │   ├── command-palette.tsx
│   │   ├── model-selector.tsx
│   │   ├── event-panel.tsx
│   │   └── settings-panel.tsx
│   ├── lib/              # 工具库
│   │   ├── store.tsx     # 状态管理
│   │   ├── types.ts      # 类型定义
│   │   └── utils.ts      # 工具函数
│   └── hooks/            # 自定义 Hooks
├── src-tauri/            # Tauri Rust 后端
│   ├── src/
│   │   ├── main.rs       # 入口
│   │   └── lib.rs        # 库
│   ├── Cargo.toml
│   └── tauri.conf.json
├── package.json
├── next.config.mjs
├── tailwind.config.ts
└── tsconfig.json
```

## 连接 Server

Desktop App 需要连接 agent-core Server 才能实现真正的 AI 对话功能。

启动 Server：
```bash
cd packages/core && bun run start
```

Server 默认监听 http://localhost:3000，Desktop App 会自动连接。

## 注意事项

- 当前使用 Mock 数据演示 UI，实际对话功能需接入真实 API
- SSE 事件流连接需要 Server 正常运行
