# Agent Core 项目文档 - Test

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

---

## 文档索引

### 核心文档

| 文档 | 描述 | 推荐时机 |
|------|------|----------|
| [`agent-core-intro.md`](./agent-core-intro.md) | 项目整体介绍 | 入门必读 |
| [`QUICKSTART.md`](./QUICKSTART.md) | 快速开始指南 | 第一次使用 |
| [`docs/agent-core-concepts.md`](./docs/agent-core-concepts.md) | 核心概念与实体 | 理解架构 |
| [`docs/project.md`](./docs/project.md) | 项目入口（本文） | 导航 |

### 🏗️ 设计理念

| 文档 | 描述 | 推荐时机 |
|------|------|----------|
| [不存在的设计文档](./docs/non-existent-design.md) | 这个文档不存在 | 测试 LSP 诊断 |
| [`docs/environment-design-philosophy.md`](./docs/environment-design-philosophy.md) | Environment 设计理念 | 深入理解核心理念 |

---

## 测试链接

下面是一个指向不存在文档的链接：

- [这个文档不存在](./docs/this-file-does-not-exist.md)
- [另一个不存在的文档](./nonexistent-file.md)

---

*本文档用于测试 LSP 诊断功能*
