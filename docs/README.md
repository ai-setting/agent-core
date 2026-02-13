# Agent Core 文档（Docs）

本目录用于沉淀 **Agent Core 的设计理念与架构决策**，目标是让后续迭代开发能做到：

- **先读文档再写代码**：明确边界、抽象与扩展点，减少返工
- **可持续演进**：每次引入新能力（tools / mcp / skills / sub-agents / runtime）都有清晰落点
- **可观测、可管控、可测试**：Environment 统一承载运行时能力与约束

> 说明：当前历史设计稿集中在 `docs/old/`。我们会逐步把“仍然有效”的内容迁移到 `docs/` 根目录，并在迁移过程中保持链接可用。

## 从这里开始

- [Environment 设计理念（统一运行时上下文）](./environment-design-philosophy.md)
- [开发进度与路线图（Progress & Roadmap）](./DEVELOPMENT_PROGRESS.md)
- [Env Spec 设计与实现（从 Environment 推导 MCP options、Stdio/HTTP 传输）](./env-spec-design-and-implementation.md)

## 现阶段仍有效的历史设计稿（位于 `docs/old/`）

- **应用架构总览（Server/CLI/Web/桌面 + SSE/EventBus）**：`old/architecture/overview.md`
- **事件 Hook 架构（统一流式事件：LLM + Tools）**：`old/event-hook-architecture.md`
- **CLI/Server/TUI 相关设计**：`old/app/`

## 文档写作约定（建议）

- **结论前置**：先给出“要解决什么问题 / 为什么这样设计 / 不这样设计会怎样”
- **边界清晰**：明确属于 Agent 的职责 vs 属于 Environment 的职责
- **可落地**：给出迭代开发时的“变更入口”（改哪里、加哪些事件、补哪些测试）

