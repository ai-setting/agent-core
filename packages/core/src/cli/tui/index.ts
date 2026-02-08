/**
 * @fileoverview TUI 入口
 * 
 * SolidJS 版本
 */

import { createTUIApp } from "./components/App.js";
import type { TUIOptions } from "./types.js";

export { createTUIApp } from "./components/App.js";
export type { TUIOptions } from "./types.js";
export { store, storeActions } from "./store.js";
export type { SessionStore } from "./store.js";
export * from "./types.js";

/**
 * 启动 TUI（兼容旧 API）
 */
export async function startTUI(options: TUIOptions): Promise<() => void> {
  const app = createTUIApp(options);
  await app.start();
  return () => app.stop();
}
