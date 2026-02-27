/**
 * @fileoverview TUI 主入口
 * 
 * SolidJS + OpenTUI 渲染入口
 */

import { render } from "@opentui/solid";
import { App } from "./components/index.js";
import { StoreProvider, ThemeProvider, MarkdownStyleProvider, EventStreamProvider, CommandProvider, DialogProvider } from "./contexts/index.js";

export interface TUIOptions {
  url: string;
  sessionID?: string;
  password?: string;
  onExit?: () => void;
}

// 保存原始 console 方法
let originalConsoleLog = console.log;
let originalConsoleDebug = console.debug;
let originalConsoleWarn = console.warn;

/**
 * 启动 TUI 应用
 */
export async function startTUI(options: TUIOptions): Promise<void> {
  // 禁用 TUI 模式下的 console.log 输出，避免日志显示在 TUI 界面上
  originalConsoleLog = console.log;
  originalConsoleDebug = console.debug;
  originalConsoleWarn = console.warn;
  console.log = () => {};
  console.debug = () => {};
  console.warn = () => {};

  const handleExit = async () => {
    // 恢复 console
    console.log = originalConsoleLog;
    console.debug = originalConsoleDebug;
    console.warn = originalConsoleWarn;
    await options.onExit?.();
    process.exit(0);
  };

  // 渲染应用
  render(() => (
    <StoreProvider>
      <ThemeProvider initialMode="dark">
        <MarkdownStyleProvider>
          <EventStreamProvider initialUrl={options.url} password={options.password}>
            <CommandProvider serverUrl={options.url}>
              <DialogProvider>
                <App
                  sessionId={options.sessionID}
                  onExit={handleExit}
                />
              </DialogProvider>
            </CommandProvider>
          </EventStreamProvider>
        </MarkdownStyleProvider>
      </ThemeProvider>
    </StoreProvider>
  ));

  // 处理进程退出
  process.on("SIGINT", handleExit);
  process.on("SIGTERM", handleExit);
}

// 导出类型和组件
export * from "./components";
export * from "./contexts";
