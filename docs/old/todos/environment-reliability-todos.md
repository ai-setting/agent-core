## BaseEnvironment / 执行可靠性 TODO 列表

围绕 `BaseEnvironment` 里的 recovery / timeout / concurrency 机制，目前存在一些尚未打通或只做了 stub 的部分，需要后续实现。

- **1. 将抽象策略方法真正接入运行时实现**
  - 抽象方法：`getDefaultTimeout`、`getTimeoutOverride`、`getMaxRetries`、`getRetryDelay`、`isRetryableError`、`getConcurrencyLimit`、`getRecoveryStrategy` 目前在 `BaseEnvironment` 中仅声明，未在实际执行路径中使用。
  - 预期：这些方法应当为上层环境提供统一的策略入口，并驱动 `TimeoutManager` / `RetryManager` / `ConcurrencyManager` / `ErrorRecovery` 的具体配置或行为。
  - TODO 方向：
    - 在构造 `TimeoutManager` / `RetryManager` / `ConcurrencyManager` / `ErrorRecovery` 时，利用这些抽象方法进行初始配置，或在 `handle_action` 中优先通过这些方法获取策略，再落到各 manager。
    - 为上述策略行为补充单元测试，覆盖 per-tool override、生效顺序（显式配置 vs 抽象策略 vs 默认值）等。

- **2. 实现 `ErrorRecovery.executeFallback` 的真实回退逻辑**
  - 当前实现：`executeFallback` 为受保护方法，默认直接 `throw new Error("Fallback execution not implemented: ...")`。
  - 预期：当 `RecoveryStrategy.type === "fallback"` 或自定义 `onError` 返回 `action: "fallback"` 时，应能真正执行一个“备用工具”并返回结果。
  - TODO 方向：
    - 设计一个能访问 environment tool registry 的 `ErrorRecovery` 子类，或将 fallback 执行逻辑上移到 `BaseEnvironment.handle_action`，由其根据 `RecoveryAction` 决定调用哪个 tool。
    - 支持将 `recoveryAction.args` 传给 fallback tool，并保证 metrics / stream events 与正常工具调用保持一致。
    - 为 fallback 流程编写单元测试（成功回退 / 回退失败 / 未配置 fallbackTool 的边界情况）。

- **3. 将 RetryManager 与 BaseEnvironment 实际执行路径打通**
  - 目前 `BaseEnvironment` 构造中会注入 `RetryManager`，但 `handle_action` 的执行路径仅通过 `ErrorRecovery.executeWithRecovery` + timeout，并未使用 `executeWithRetry`。
  - 预期：对于“可重试”错误，应通过 `RetryManager` 提供的指数退避 + jitter 机制进行自动重试。
  - TODO 方向：
    - 方案 A：在 `ErrorRecovery` 内部组合使用 `RetryManager`，根据 `RecoveryStrategy` 与 `RetryManager.isRetryableError` 共同决定是否/如何重试。
    - 方案 B：在 `BaseEnvironment.handle_action` 中先通过 `executeWithRetry` 包裹工具执行，再交给 `ErrorRecovery` 处理非重试类错误。
    - 无论选择哪种方案，都需要明确错误分类（哪些错误交给 retry，哪些交给 recovery）并补充分支测试。

- **4. 并发策略统一入口**
  - 当前 `ConcurrencyManager` 的并发上限主要通过自身的 `defaultLimit` + per-tool `setConcurrencyLimit` 控制，与 `BaseEnvironment.getConcurrencyLimit` 抽象方法尚未关联。
  - TODO 方向：
    - 在 environment 初始化时，根据 `getConcurrencyLimit(toolName)` 为已知工具预配置并发上限，或在 `handle_action` 里在首次遇到某个 tool 时设置其 limit。
    - 补充测试覆盖：默认并发限制、自定义限制生效、超出并发导致队列等待与超时的行为。

- **5. 文档与示例**
  - 在 `docs` 或 `examples` 中增加一个最小工作示例，展示：
    - 如何基于 `BaseEnvironment` 子类化实现自定义策略（超时 / 重试 / 回退 / 并发）。
    - 如何注入自定义的 `ErrorRecovery` / `RetryManager` / `ConcurrencyManager` 实例。
  - 补充面向使用者的配置指南，说明这些策略的默认行为与可扩展点。

