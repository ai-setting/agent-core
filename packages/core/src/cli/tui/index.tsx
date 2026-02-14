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

/**
 * 启动 TUI 应用
 */
export async function startTUI(options: TUIOptions): Promise<void> {
  const handleExit = () => {
    options.onExit?.();
    process.exit(0);
  };

  // 渲染应用
  render(() => (
    <StoreProvider>
      <ThemeProvider initialMode="dark">
        <MarkdownStyleProvider>
          <EventStreamProvider initialUrl={options.url} password={options.password} onExit={handleExit}>
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
