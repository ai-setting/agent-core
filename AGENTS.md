# Agent Core 项目开发 Agent 行为规范（AGENTS.md）

本文件用于约束“参与开发 `agent-core` 的 AI Agent”的行为：**怎么理解项目、怎么保证设计一致性、怎么改代码、怎么跑测试/联调、怎么定位日志**。目标是让每次迭代都沿着既定的 Environment 设计目标稳步推进。

---

## 0. 最高优先级（必须遵守）

- **以 Environment 为中心**：能力与约束的注入（tools / mcp / skills / sub-agents / 事件 / 治理策略 / 可观测接口 / 配置）优先落在 `Environment`（或其子类）层，而不是侵入 `Agent` 核心。
- **先读设计，再写实现**：任何新增/调整抽象前，必须先阅读并对齐：
  - `docs/environment-design-philosophy.md`
  - `docs/DEVELOPMENT_PROGRESS.md`（看当前进度、缺口、下一阶段重点）
  - `docs/config-design.md`（配置系统设计，配置相关开发必读）
- **让路线图前进**：每次实现重要能力后，必须同步更新 `docs/DEVELOPMENT_PROGRESS.md`（能力矩阵状态、近期待办、里程碑）。

---

## 1. 必读文档（开发前）

- **Docs 入口**：`docs/README.md`
- **设计理念**：`docs/environment-design-philosophy.md`
- **进度与路线图**：`docs/DEVELOPMENT_PROGRESS.md`
- **配置系统设计**：`docs/config-design.md`

---

## 2. 开发行为规范（怎么做改动）

### 2.1 设计一致性检查（每次实现前都要做）

- **新增能力**（例：MCP、Skills、Sub-agents、日志/回放/审计接口）：优先新增/扩展 `Environment` 相关接口与实现，并明确事件/日志闭环。
- **新增工具**：必须通过 `Environment` 的注册/执行入口，确保可统一治理（超时/并发/重试/审计/事件）。
- **新增事件**：必须考虑 server SSE、TUI 消费、schema 兼容与版本化（这是当前路线图 M1 的重点）。
- **配置相关变更**（新增配置字段、配置来源、状态持久化）：必须遵循 `docs/config-design.md` 的设计规范，优先落在 `packages/core/src/config/` 目录，通过 `ConfigSource` 抽象注册。

### 2.2 分层边界（强约束）

- **Agent**：只做"决策与编排"，不做 I/O，不直接依赖 OS/MCP/Skills 的具体实现。
- **BaseEnvironment / Environment 子类**：统一承载工具装配、执行治理、事件 hook、可观测能力入口。
- **ServerEnvironment / OsEnv / TestEnv（未来）**：隔离运行形态差异（Server/CLI/Test），不要把差异撒到 Agent 里。

### 2.3 代码提交规范

- **Commit Message 语言**：所有 commit message 必须使用**英语**编写，遵循 Conventional Commits 规范。
  - 格式：`type: subject`（如 `refactor: transform invoke_llm from tool to native Environment API`）
  - type 可选值：`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `style`
  - subject 使用现在时态，首字母不大写，句末不加句号
  - 正文详细说明改动内容，每行不超过 72 个字符

---

## 3. 测试规范（每次改动后必须自证正确）

> 项目使用 Bun。优先在 `agent-core/` 根目录执行脚本（会代理到 `packages/core`）。

### 3.1 基础测试（至少跑一项）

- **单测**：`bun run test`
- **类型检查**：`bun run typecheck`

### 3.2 前后端联调（Server ↔ TUI）

联调目标：验证 **Server 事件总线 + SSE** 到 **TUI 事件流消费** 的端到端链路。

- **启动 Server**：`bun run start`
- **启动 TUI attach 到 server**：`bun run attach http://localhost:3001`

自动化联调（优先用脚本替代手工）：
- Windows（PowerShell）：`test-integration.ps1` / `integration-test.ps1`
- *nix：`test-integration.sh` / `test-tui.sh`

联调时必须关注：
- SSE `/events` 是否稳定（heartbeat、断线重连）
- 事件 flatten 格式是否一致（server 侧 `{type, properties}` → `{type, ...properties}`）
- sessionId 的一致性与过滤行为

### 3.3 TUI 界面测试规范（必须遵守）

**对于涉及 TUI 改动的功能，必须通过以下方式验证：**

1. **启动完整环境**：
   ```bash
   # Terminal 1: 启动 Server
   bun run start
   
   # Terminal 2: 启动 TUI
   bun run attach http://localhost:3000
   ```

2. **模拟用户操作**：
   - 在 TUI 中执行具体操作（如输入 `/` 触发命令面板）
   - 观察界面响应和状态变化

3. **验证日志输出**：
   - 查看 `tui.log` 确认逻辑执行
   - 关键操作应有明确日志标记，如：
     ```
     [CommandContext] Opening command palette
     [CommandContext] Refreshing commands from server
     [InputBox] Detected command
     ```

4. **验收标准**：
   - TUI 界面有预期响应（弹窗、状态变化等）
   - 日志文件记录完整的操作链路
   - 无异常错误或崩溃

**TUI 日志位置**：`~/.config/tong_work/logs/tui.log`

---

## 4. 日志规范（必须先看日志再猜）

### 4.1 日志目录与文件（当前实现为固定目录）

当前 logger 目录固定为用户 HOME 下：

- **日志目录**：`~/.config/tong_work/logs/`
  - Windows 示例：`%USERPROFILE%\.config\tong_work\logs\`

常用文件：
- **Server 日志**：`server.log`
- **TUI 日志**：`tui.log`

关键实现位置（以代码为准）：
- `packages/core/src/utils/logger.ts`（固定 `LOG_DIR`）
- `packages/core/src/server/logger.ts`
- `packages/core/src/cli/tui/logger.ts`

> 说明：当前 logger 读取 `LOG_LEVEL` 控制级别；**不会**以 `LOG_FILE` 环境变量决定落盘路径。

### 4.2 日志输出规范（必须遵守）

**必须使用项目内部的 Logger 类**，不要使用 `console.log`：

```typescript
// ❌ 错误：不会写入日志文件
console.log("[InputBox] handleSubmit called");

// ✅ 正确：会同时输出到控制台和日志文件
import { tuiLogger } from "../logger.js";
tuiLogger.info("[InputBox] handleSubmit called", { content });
```

**不同模块使用对应的 logger：**

```typescript
// Server 端
import { serverLogger } from "../server/logger.js";
serverLogger.info("Processing request", { sessionId });

// TUI 端
import { tuiLogger, eventLogger } from "../cli/tui/logger.js";
tuiLogger.info("Component mounted");
eventLogger.debug("Event received", { type: event.type });

// 通用模块
import { createLogger } from "../utils/logger.js";
const myLogger = createLogger("my:module", "my.log");
myLogger.info("Message");
```

**Logger 方法：**
- `debug(message, data?)` - 调试信息
- `info(message, data?)` - 一般信息
- `warn(message, data?)` - 警告信息
- `error(message, data?)` - 错误信息

### 4.3 联调排查顺序（建议）

1) 先看 `server.log`：是否有 SSE 连接与事件发送（如 `Client connected` / `Sending event to client`）  
2) 再看 `tui.log`：是否成功连接事件流、是否收到事件  
3) 核对 sessionId、事件类型与字段是否匹配（尤其是 flatten 后字段）

---

## 5. 必须同步更新进度文档的变更类型

当你实现或显著推进以下任意一类能力，必须更新 `docs/DEVELOPMENT_PROGRESS.md`：

- 配置系统（用户级配置、ConfigSource 抽象、状态持久化）
- 事件 schema/version、可观测闭环（日志/回放/审计）
- MCP 装配为工具
- Skills 加载/注册/隔离
- Sub-agents 编排与权限收敛
- 执行治理（超时/并发/重试/熔断/降级）及其可观测性

