# Agent Core 项目文档

<p align="center">
  <img src="https://img.shields.io/badge/Version-0.1.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/Tests-249%20passed-green" alt="Tests">
  <img src="https://img.shields.io/badge/Coverage-85%25-green" alt="Coverage">
</p>

> Agent Core 是一个轻量级 AI Agent 框架，专注于为 AI 代理提供统一的运行时环境。

---

## 目录

1. [项目理念](#项目理念)
2. [核心目标](#核心目标)
3. [功能特性](#功能特性)
4. [故事线阅读指南](#故事线阅读指南)
5. [快速开始](#快速开始)
6. [文档索引](#文档索引)

---

## 项目理念

> **一句话概括：Agent 负责"想清楚做什么"，Environment 负责"在什么世界里、用什么能力、以什么约束去做"。**

Agent Core 的核心创新在于引入了 **Environment（环境）** 概念——它不仅仅是配置容器，而是一个可交互的环境实体：

| 理念 | 描述 |
|------|------|
| **统一运行时** | Agent 无需关心运行在 CLI、Server 还是测试环境 |
| **统一治理** | 权限、超时、重试、并发、审计等策略在 Env 层面统一实施 |
| **统一观测** | LLM 流、工具调用、资源变化等都能以事件形式被订阅 |
| **统一复用** | 同一套 Agent 逻辑可以在不同的 Environment 中呈现不同角色 |

### 架构图

```
┌─────────────────────────────────────────────────────────┐
│                      Agent                                │
│  (负责任务理解、计划、推理与决策)                          │
└─────────────────────┬───────────────────────────────────┘
                      │ 调用
                      ▼
┌─────────────────────────────────────────────────────────┐
│                    Environment                            │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐│
│  │   Prompts   │ │   Tools     │ │   Sub-agents        ││
│  │  (角色配置)  │ │ (MCP/Skills)│ │   (子代理管理)       ││
│  └─────────────┘ └─────────────┘ └─────────────────────┘│
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐│
│  │   事件/日志  │ │   治理策略   │ │   资源管理          ││
│  │ (可观测性)   │ │ (安全/权限)  │ │   (工件/会话)       ││
│  └─────────────┘ └─────────────┘ └─────────────────────┘│
└─────────────────────┬───────────────────────────────────┘
                      │ 执行
                      ▼
┌─────────────────────────────────────────────────────────┐
│                   外部世界                                │
│  (文件系统、进程、网络、数据库、MCP服务)                   │
└─────────────────────────────────────────────────────────┘
```

---

## 核心目标

### 当前里程碑

| 里程碑 | 状态 | 描述 |
|--------|------|------|
| **M0** | ✅ 已完成 | 基础可用 - Environment/Agent 主干跑通、Server 事件总线 + SSE、OS Env + 基础工具 |
| **M1** | 🔄 进行中 | 配置与可观测闭环 - 配置系统、状态持久化、统一事件 schema |
| **M2** | 📋 规划中 | 能力装配 - MCP 连接、Skills 加载与版本化 |
| **M3** | 📋 规划中 | Sub-agents - 子代理编排、权限收敛、并行探索 |
| **M4** | 📋 规划中 | 可靠性与安全 - 超时/并发/重试/熔断、权限与审计 |

### 能力矩阵（当前进度）

```
已完成 ✅                进行中 🔄              规划中 📋
─────────────────────────────────────────────────────────────
• Environment 核心骨架    • CLI/TUI 完善        • Skills 体系
• LLM 调用与流式事件     • 治理策略闭环         • Env 原生接口
• Server EventBus + SSE  • 可靠性恢复          • 安全与审计
• OS Tools (bash/file)   • Metrics 指标         
• 配置系统 (Global)      • 环境事件机制         
• Session 持久化        • MCP 集成             
• Command 系统          • Sub-agents 编排      
• Models/Sessions 命令    
```

---

## 功能特性

### 1. 🛠️ 工具调用 (Tools)

| 类型 | 示例 | 功能 |
|------|------|------|
| **OS 工具** | `bash`, `read_file`, `write_file`, `glob`, `grep` | 文件系统操作 |
| **Todo 工具** | `todo_read`, `todo_add`, `todo_write` | 任务管理 |
| **Web 工具** | `web_fetch`, `exa_web_search` | 网络请求 |
| **LSP 工具** | `lsp` (goToDefinition, findReferences) | 代码分析 |
| **Trace 工具** | `get_trace`, `get_logs_for_request` | 日志分析 |
| **Task 工具** | `task`, `stop_task` | 子代理委托 |

### 2. 🤖 LLM 集成

- 支持 OpenAI 格式的适配器
- 可配置多个 LLM 提供商
- 支持 Interleaved Reasoning（如 Kimi k2.5、DeepSeek R1）

### 3. 🛡️ 错误恢复机制

- **超时控制**：全局/工具级超时配置
- **重试机制**：指数退避重试临时错误
- **Doom Loop 检测**：防止相同工具无限循环调用
- **并发限制**：防止资源耗尽

### 4. 📡 流式事件

支持以下事件类型：
- `start` / `text` / `reasoning` / `completed` / `error` - LLM 生命周期
- `tool_call` / `tool_result` - 工具调用
- `SESSION_CREATED` / `SESSION_UPDATED` / `SESSION_DELETED` - 会话事件
- `BACKGROUND_TASK_*` - 后台任务事件
- `timer.*` - 定时器事件

### 5. 📊 可观测性

- 运行时日志查询与订阅
- 事件流广播（SSE）
- 审计与脱敏

---

## 故事线阅读指南

> 不同的读者角色，建议不同的阅读顺序：

### 👶 新手入门（理解项目是什么）

```
1. agent-core-intro.md     → 项目整体介绍
   ↓
2. QUICKSTART.md           → 快速开始
   ↓
3. docs/project.md (本文)  → 找到方向
```

### 🧑‍🎓 开发者（理解架构和设计）

```
1. docs/environment-design-philosophy.md  → 核心理念
   ↓
2. docs/agent-core-concepts.md            → 核心概念与实体
   ↓
3. docs/DEVELOPMENT_PROGRESS.md          → 当前进度与路线图
```

### 🚀 贡献者（了解具体实现）

```
1. 选择感兴趣的功能领域
   ↓
2. 阅读对应的设计文档
   ↓
3. 查看关键代码路径
```

---

## 快速开始

### 安装

```bash
npm install
```

### 基本用法

```typescript
import { ServerEnvironment } from "@agent-core/core";

// 1. 创建环境
const env = new ServerEnvironment({
  sessionId: "my-session"
});

// 2. 等待配置加载
await env.waitForReady();

// 3. 处理查询
const response = await env.handle_query(
  "请帮我读取当前目录下的 package.json 文件",
  { session_id: "my-session" }
);

console.log(response);
```

### 启动 Server

```typescript
import { AgentServer, ServerEnvironment } from "@agent-core/core";

const env = new ServerEnvironment();
const server = new AgentServer({ env });

await server.start();
// Server running at http://0.0.0.0:4096
```

---

## 文档索引

### 📖 核心文档

| 文档 | 描述 | 推荐时机 |
|------|------|----------|
| [`agent-core-intro.md`](./agent-core-intro.md) | 项目整体介绍 | 入门必读 |
| [`QUICKSTART.md`](./QUICKSTART.md) | 快速开始指南 | 第一次使用 |
| [`docs/agent-core-concepts.md`](./docs/agent-core-concepts.md) | 核心概念与实体 | 理解架构 |
| [`docs/project.md`](./docs/project.md) | 项目入口（本文） | 导航 |

### 🏗️ 设计理念

| 文档 | 描述 | 推荐时机 |
|------|------|----------|
| [`docs/environment-design-philosophy.md`](./docs/environment-design-philosophy.md) | Environment 设计理念 | 深入理解核心理念 |
| [`docs/env-spec-design-and-implementation.md`](./docs/env-spec-design-and-implementation.md) | Env Spec 设计与实现 | MCP 集成开发 |
| [`docs/environment-event-mechanism.md`](./docs/environment-event-mechanism.md) | 环境事件机制设计 | 事件系统开发 |

### 📋 开发进度

| 文档 | 描述 | 推荐时机 |
|------|------|----------|
| [`docs/DEVELOPMENT_PROGRESS.md`](./docs/DEVELOPMENT_PROGRESS.md) | 开发进度与路线图 | 了解当前状态 |
| [`docs/README.md`](./docs/README.md) | Docs 目录说明 | 导航设计文档 |

### 🛠️ 功能模块

#### 配置系统

| 文档 | 描述 |
|------|------|
| [`docs/config-design.md`](./docs/config-design.md) | 配置系统设计 |
| [`docs/providers-config-centralization-design.md`](./docs/providers-config-centralization-design.md) | Provider 配置集中化 |
| [`docs/models-config-guide.md`](./docs/models-config-guide.md) | 模型配置指南 |
| [`docs/app-config-management.md`](./docs/app-config-management.md) | 应用配置管理 |

#### 命令系统

| 文档 | 描述 |
|------|------|
| [`docs/sessions-command-design.md`](./docs/sessions-command-design.md) | Sessions 命令设计 |
| [`docs/models-config-guide.md`](./docs/models-config-guide.md) | Models 命令指南 |
| [`docs/agent-env-command-design.md`](./docs/agent-env-command-design.md) | Agent-Env 命令设计 |

#### 工具与技能

| 文档 | 描述 |
|------|------|
| [`docs/agent-core-skill-mechanism-design.md`](./docs/agent-core-skill-mechanism-design.md) | Skill 机制设计 |
| [`docs/task-tool-subagent-design.md`](./docs/task-tool-subagent-design.md) | 子代理设计 |
| [`docs/trace-tools-design.md`](./docs/trace-tools-design.md) | Trace 工具设计 |
| [`docs/lsp-implementation-design.md`](./docs/lsp-implementation-design.md) | LSP 工具设计 |

#### 会话系统

| 文档 | 描述 |
|------|------|
| [`docs/session-messages-optimization.md`](./docs/session-messages-optimization.md) | 会话消息优化 |
| [`docs/session-query-enhancement.md`](./docs/session-query-enhancement.md) | 会话查询增强 |

#### 集成与扩展

| 文档 | 描述 |
|------|------|
| [`docs/openclaw-feishu-integration.md`](./docs/openclaw-feishu-integration.md) | 飞书集成 |
| [`docs/agent-core-feishu-integration-design.md`](./docs/agent-core-feishu-integration-design.md) | 飞书集成设计 |
| [`docs/sandbox-integration-design.md`](./docs/sandbox-integration-design.md) | 沙箱集成设计 |

#### 安全与可靠性

| 文档 | 描述 |
|------|------|
| [`docs/esc-interrupt-design.md`](./docs/esc-interrupt-design.md) | 中断机制设计 |
| [`docs/system-prompt-injection-design.md`](./docs/system-prompt-injection-design.md) | System Prompt 注入 |

#### 高级主题

| 文档 | 描述 |
|------|------|
| [`docs/llm-interleaved-reasoning.md`](./docs/llm-interleaved-reasoning.md) | Interleaved Reasoning 处理 |
| [`docs/extensible-config-design.md`](./docs/extensible-config-design.md) | 可扩展配置设计 |
| [`docs/commit-version-injection-and-help-mechanism-design.md`](./docs/commit-version-injection-and-help-mechanism-design.md) | 版本注入与帮助机制 |

---

## 关键代码路径

```
packages/core/src/
├── core/
│   ├── agent/              # Agent 执行引擎
│   │   └── index.ts        # Agent 主类
│   ├── environment/
│   │   ├── base/           # BaseEnvironment 实现
│   │   │   ├── base-environment.ts
│   │   │   └── invoke-llm.ts
│   │   └── index.ts        # Environment 接口
│   ├── session/            # Session 管理
│   │   ├── session.ts
│   │   └── storage.ts
│   └── types/              # 类型定义
├── server/
│   ├── environment.ts      # ServerEnvironment
│   ├── server.ts           # HTTP Server
│   ├── eventbus/           # 事件总线
│   │   └── bus.ts
│   └── command/            # 命令系统
└── config/                 # 配置系统
```

---

## 相关资源

- **测试状态**: 249 个测试全部通过
- **测试覆盖率**: 84.89% 函数, 89.76% 行
- **版本**: 0.1.0 (dev)
- **Commit**: d912ead3d34d7c73177c0d523de3c31ecccccf64

---

*本文档最后更新：2026-03-11*
