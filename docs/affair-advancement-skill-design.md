# 事务推进（Affair）Skill 设计文档

> 本文档描述 zst 环境中事务推进 Skill 的设计与实现方案。
> 
> 目标：让 Agent 在处理用户任务意图时，自动使用 Info Feed MCP 的 Affair（事务）系统进行任务管理和推进。

## 1. 概述

### 1.1 背景

在 zst 环境中，用户经常有"进行某些任务处理"的意图。我们需要一个统一的机制来：
- 将用户意图转化为可追踪的事务（Affair）
- 支持事务的层级化管理（通过 `parent_affair_id`）
- 在后台推进事务执行
- 同步事务状态给用户
- 最终判定事务是否完成并报告

### 1.2 设计原则

1. **以 Environment 为中心**：事务能力通过 Environment 的 rules.md 和 MCP 工具注入，不侵入 Agent 核心
2. **Skill 驱动**：通过事务推进 Skill 提供 Agent 行为指导，而非硬编码逻辑
3. **异步推进**：使用 TaskTool 后台任务机制，不阻塞用户交互
4. **事件驱动**：后台任务状态变化通过事件通知主 session

### 1.3 Info Feed MCP Affair 工具

工具已注册到 Environment，LLM 可直接调用：

| 工具名称 | 功能 |
|---------|------|
| `info-feed-mcp_affair_list` | 获取事务列表 |
| `info-feed-mcp_affair_get` | 获取事务详情 |
| `info-feed-mcp_affair_create` | 创建事务 |
| `info-feed-mcp_affair_update` | 更新事务状态 |
| `info-feed-mcp_affair_delete` | 删除事务 |
| `info-feed-mcp_affair_complete` | 完成事务 |
| `info-feed-mcp_user_list` | 获取用户列表 |

---

## 2. 文件位置

所有 zst 环境相关文件都在**用户配置路径**下：

```
~/.config/tong_work/agent-core/environments/zst/
├── config.jsonc                              # 环境配置
├── agents.jsonc                              # Agent 配置
├── rules.md                                  # 环境规则（已更新）
├── prompts/                                  # Agent prompts
│   └── system.prompt
└── skills/                                   # Skills 目录
    └── affair-advancement/
        └── skill.md                          # 事务推进 skill
```

---

## 3. rules.md 内容

在 rules.md 中新增「事务处理规则」章节，引导 Agent 使用事务推进 skill。

---

## 4. skill.md 内容

skill.md 聚焦于流程指导，不重复工具参数说明（工具参数 LLM 已知）。

核心流程：
1. 意图分析与事务匹配
2. 事务创建（调用 MCP 工具）
3. 启动后台任务（调用 task 工具）
4. 向用户报告

---

## 5. 事件处理

### 5.1 事件类型

| 事件类型 | 触发时机 | 通知内容 |
|---------|---------|---------|
| `BACKGROUND_TASK_COMPLETED` | 任务成功完成 | 结果摘要 |
| `BACKGROUND_TASK_FAILED` | 任务执行失败 | 错误信息 |
| `BACKGROUND_TASK_PROGRESS` | 每2分钟 | 执行时长 |
| `BACKGROUND_TASK_TIMEOUT` | 15分钟超时 | 超时暂停提示 |
| `BACKGROUND_TASK_STOPPED` | 用户主动停止 | 停止确认 |

### 5.2 事件路由

所有事件通过 `trigger_session_id` 路由到主 session，由 EventBus 处理并触发 Agent 向用户报告。

---

## 6. 实现清单

| 任务 | 文件位置 | 状态 |
|------|----------|------|
| 更新 rules.md | `~/.config/tong_work/agent-core/environments/zst/rules.md` | ✅ |
| 创建 skill.md | `~/.config/tong_work/agent-core/environments/zst/skills/affair-advancement/skill.md` | ✅ |
| 新增事件类型 | `packages/core/src/core/types/event.ts` | ✅ |
| 新增事件处理规则 | `packages/core/src/server/environment.ts` | ✅ |
| 创建 StopTaskTool | `packages/core/src/core/environment/expend/task/stop-task-tool.ts` | ✅ |
| 更新 BackgroundTaskManager | `packages/core/src/core/environment/expend/task/background-task-manager.ts` | ✅ |
| 更新 task-tool.ts | `packages/core/src/core/environment/expend/task/task-tool.ts` | ✅ |
| 默认超时延长到15分钟 | `background-task-manager.ts` | ✅ |
| 进度报告间隔2分钟 | `background-task-manager.ts` | ✅ |

---

## 7. 验收标准

- [x] 用户输入任务意图后，Agent 能自动加载事务推进 skill
- [x] 能正确调用 MCP 工具创建/更新事务
- [x] 后台任务能正常启动和执行
- [x] 任务完成通过 BACKGROUND_TASK_COMPLETED 事件通知
- [x] 进度事件每2分钟自动发布
- [x] 超时事件（15分钟）正确触发并发布 BACKGROUND_TASK_TIMEOUT
- [x] 停止事件通过 stop_task 工具正确发布
- [x] 事件元数据正确（trigger_session_id 指向主 session）

---

## 8. 测试覆盖

| 测试文件 | 测试数量 | 覆盖内容 |
|---------|---------|---------|
| background-task-manager.test.ts | 13 | 任务创建、状态管理、停止、事件发布 |
| background-task-notification.test.ts | 10 | 事件路由、元数据、停止通知 |
| stop-task-tool.test.ts | 8 | 工具定义、成功/失败场景 |

**总计**: 55 tests passed

---

## 9. 相关文档

- [TaskTool 设计](./task-tool-subagent-design.md)
- [Environment 设计理念](./environment-design-philosophy.md)
