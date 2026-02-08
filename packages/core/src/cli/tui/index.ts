/**
 * @fileoverview TUI 入口
 * 
 * 启动基于 TUI 的交互式 CLI
 */

import { createTUIApp } from "./components/App";
import type { TUIOptions } from "./types";

export { createTUIApp };
export type { TUIOptions };
export { EventStreamManager } from "./hooks/useEventStream";

/**
 * 启动 TUI 界面
 * 
 * @param options - TUI 配置选项
 * @returns 清理函数
 * 
 * @example
 * ```typescript
 * import { startTUI } from "./tui";
 * 
 * const cleanup = await startTUI({
 *   url: "http://localhost:3000",
 *   sessionID: "abc123"
 * });
 * ```
 */
export async function startTUI(options: TUIOptions): Promise<() => void> {
  const app = createTUIApp(options);
  
  // 处理进程退出
  const handleExit = () => {
    app.stop();
    process.exit(0);
  };

  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);
  process.on("exit", handleExit);

  // 启动应用
  await app.start();

  // 返回清理函数
  return () => {
    process.removeListener("SIGINT", handleExit);
    process.removeListener("SIGTERM", handleExit);
    process.removeListener("exit", handleExit);
    app.stop();
  };
}
