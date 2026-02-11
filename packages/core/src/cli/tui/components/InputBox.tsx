/**
 * @fileoverview InputBox 组件 - OpenCode 风格实现
 *
 * 使用 textarea + CommandPalette ref 模式
 */

import { createSignal, onCleanup, createEffect, Show, For, type JSX } from "solid-js";
import { useStore, useEventStream, useTheme, useCommand, useDialog } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";
import { CommandPalette, type CommandPaletteRef } from "./CommandPalette.js";
import { CommandDialog } from "./CommandDialog.js";

const STREAMING_DOT_COUNT = 5;
const STREAMING_DOT_TICK_MS = 120;

// 模块级标志位：是否正在清空/设置 textarea（用于忽略事件）
let isClearingFlag = false;

interface PendingCommandResult {
  name: string;
  success: boolean;
  message?: string;
}

export function InputBox() {
  const store = useStore();
  const eventStream = useEventStream();
  const theme = useTheme();
  const dialog = useDialog();
  const command = useCommand();

  const [input, setInput] = createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [streamingDotIndex, setStreamingDotIndex] = createSignal(0);
  const [pendingResult, setPendingResult] = createSignal<PendingCommandResult | null>(null);

  // CommandPalette ref - OpenCode 风格
  let commandPalette: CommandPaletteRef | null = null;
  // textarea ref
  let textareaRef: any = null;

  // 监听 dialog 关闭，自动聚焦输入框
  createEffect(() => {
    const wasOpen = dialog.isOpen();
    if (!wasOpen && textareaRef) {
      // Dialog 关闭了，聚焦输入框
      tuiLogger.info("[InputBox] Dialog closed, focusing textarea");
      try {
        if (textareaRef.focus) {
          textareaRef.focus();
        }
      } catch (err) {
        tuiLogger.warn("[InputBox] Failed to focus textarea", { error: String(err) });
      }
    }
  });

  // 使用 effect 来处理命令结果显示，确保在 Solid 渲染上下文中
  createEffect(() => {
    const result = pendingResult();
    if (!result) return;

    tuiLogger.info("[InputBox] Showing command result dialog", { name: result.name });

    const currentTheme = theme.theme();

    dialog.push(
      () => (
        <box flexDirection="column" padding={1} width="100%" height="100%">
          {/* 隐藏的 input 用于捕获 ESC 键 */}
          <input
            width={0}
            value=""
            opacity={0}
            focused={true}
            onKeyDown={(e: any) => {
              if (e.name === "escape" || e.key === "Escape") {
                tuiLogger.info("[CommandResult] ESC pressed, closing");
                dialog.pop();
              }
            }}
          />
          <box flexDirection="row" alignItems="center" height={1} marginBottom={1}>
            <text fg={result.success ? currentTheme.success : currentTheme.error}>
              {result.success ? "✓" : "✗"}
            </text>
            <text fg={currentTheme.foreground} marginLeft={1}>
              {result.success ? "Success" : "Failed"}
            </text>
          </box>
          <Show when={result.message}>
            <box
              flexDirection="column"
              padding={1}
              borderStyle="single"
              borderColor={currentTheme.border}
              marginTop={1}
            >
              <text fg={currentTheme.foreground}>{result.message}</text>
            </box>
          </Show>
          <box flexDirection="row" height={1} marginTop={1}>
            <text fg={currentTheme.muted}>Press ESC to close</text>
          </box>
        </box>
      ),
      { title: `Result: /${result.name}` }
    );

    // 清除 pending 状态
    setPendingResult(null);
  });

  createEffect(() => {
    if (!store.isStreaming()) return;
    setStreamingDotIndex(0);
    const id = setInterval(() => {
      setStreamingDotIndex((i) => (i + 1) % STREAMING_DOT_COUNT);
    }, STREAMING_DOT_TICK_MS);
    onCleanup(() => clearInterval(id));
  });

  const handleSubmit = async () => {
    const content = input().trim();
    tuiLogger.info("[InputBox] handleSubmit called", { content });
    
    if (!content || store.isStreaming() || isSubmitting()) {
      tuiLogger.info("[InputBox] Submit rejected", { 
        empty: !content, 
        streaming: store.isStreaming(), 
        submitting: isSubmitting() 
      });
      return;
    }

    // 如果命令面板显示中，不提交
    if (commandPalette?.visible) {
      tuiLogger.info("[InputBox] Submit rejected - palette visible");
      return;
    }

    setIsSubmitting(true);
    setInput("");
    
    // 手动清空 textarea - 使用正确的方法
    if (textareaRef) {
      tuiLogger.info("[InputBox] Clearing textarea");
      // 设置标志位，忽略接下来的 onContentChange 事件
      isClearingFlag = true;
      try {
        // OpenTUI textarea 使用 setText 或 clear 方法
        if (textareaRef.clear) {
          textareaRef.clear();
        } else if (textareaRef.setText) {
          textareaRef.setText("");
        }
        // 重置光标位置
        if (textareaRef.cursorOffset !== undefined) {
          textareaRef.cursorOffset = 0;
        }
      } catch (err) {
        tuiLogger.warn("[InputBox] Failed to clear textarea", { error: String(err) });
      }
      // 延迟重置标志位，确保异步事件也被忽略
      setTimeout(() => {
        isClearingFlag = false;
        tuiLogger.info("[InputBox] Clearing flag reset");
      }, 100);
    }

    try {
      if (content.startsWith("/")) {
        tuiLogger.info("[InputBox] Executing command", { content });
        // 解析命令：/commandName args...
        const parts = content.slice(1).split(" ");
        const cmdName = parts[0];
        const args = parts.slice(1).join(" ");
        
        tuiLogger.info("[InputBox] Parsed command", { cmdName, args });
        
        // 执行命令
        await executeCommand(cmdName, args);
      } else {
        tuiLogger.info("[InputBox] Sending prompt");
        await eventStream.sendPrompt(content);
      }
    } catch (err) {
      tuiLogger.error("[InputBox] Submit failed", { error: String(err) });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // 执行命令
  const executeCommand = async (name: string, args: string) => {
    tuiLogger.info("[InputBox] Executing command via context", { name, args });

    const result = await command.executeCommand(name, args);

    // 设置 pending result，由 effect 处理对话框显示
    setPendingResult({
      name,
      success: result.success,
      message: result.message,
    });
  };

  const modelLabel = () => store.lastModelName() || "OpenCode Zen";

  return (
    <box flexDirection="column">
      {/* CommandPalette - 独立组件，通过 ref 通信 */}
      <CommandPalette
        ref={(ref) => {
          tuiLogger.info("[InputBox] CommandPalette ref set", { hasRef: !!ref });
          commandPalette = ref;
        }}
        onSelectCommand={(cmdName) => {
          tuiLogger.info("[InputBox] Command selected from palette", { cmdName });
          // 插入命令名到输入框
          const newText = `/${cmdName} `;
          setInput(newText);
          // 尝试设置 textarea 的值 - 使用正确的方法
          if (textareaRef) {
            // 设置标志位，忽略接下来的 onContentChange 事件
            isClearingFlag = true;
            try {
              if (textareaRef.setText) {
                textareaRef.setText(newText);
              }
              if (textareaRef.cursorOffset !== undefined) {
                textareaRef.cursorOffset = newText.length;
              }
            } catch (err) {
              tuiLogger.warn("[InputBox] Failed to set textarea text", { error: String(err) });
            }
            // 延迟重置标志位
            setTimeout(() => {
              isClearingFlag = false;
              tuiLogger.info("[InputBox] Select command clearing flag reset");
            }, 100);
          }
        }}
      />

      {/* 输入框主体 */}
      <box 
        flexDirection="column" 
        borderStyle="single" 
        borderColor={theme.theme().border}
      >
        {/* 上行：用户输入 */}
        <box
          flexDirection="row"
          alignItems="center"
          paddingLeft={1}
          paddingRight={1}
          paddingTop={0}
          paddingBottom={0}
          height={1}
        >
          <box flexGrow={1} minWidth={0}>
            <textarea
              ref={(ref: any) => {
                tuiLogger.info("[InputBox] textarea ref set", { hasRef: !!ref });
                textareaRef = ref;
              }}
              flexGrow={1}
              height={1}
              initialValue={input()}
              onContentChange={(event: any) => {
                // 如果正在清空，忽略此事件
                if (isClearingFlag) {
                  tuiLogger.info("[InputBox] onContentChange ignored - clearing in progress");
                  return;
                }
                
                // 直接从 textarea ref 获取值，而不是依赖 event
                const value = textareaRef?.plainText || textareaRef?.value || 
                             (typeof event === 'string' ? event : event.value) || '';
                tuiLogger.info("[InputBox] onContentChange fired", { 
                  value,
                  textareaPlainText: textareaRef?.plainText,
                  textareaValue: textareaRef?.value,
                  eventValue: typeof event === 'string' ? event : event?.value,
                  hasTextareaRef: !!textareaRef,
                  hasCommandPalette: !!commandPalette
                });
                setInput(value);
                // 调用 CommandPalette 的 onInput - OpenCode 风格
                if (textareaRef && commandPalette) {
                  tuiLogger.info("[InputBox] Calling CommandPalette.onInput");
                  commandPalette.onInput(value, textareaRef);
                } else {
                  tuiLogger.warn("[InputBox] Cannot call onInput", { 
                    hasTextareaRef: !!textareaRef, 
                    hasCommandPalette: !!commandPalette 
                  });
                }
              }}
              onKeyDown={(e: any) => {
                // 如果正在提交，忽略键盘事件（但不清空标志位，因为那是给 onContentChange 用的）
                if (isSubmitting()) {
                  tuiLogger.info("[InputBox] onKeyDown ignored - submitting");
                  e.preventDefault();
                  return;
                }

                // 检查 Ctrl+P 快捷键（打开 Command Dialog）
                if ((e.ctrlKey || e.control) && (e.key === "p" || e.name === "p")) {
                  tuiLogger.info("[InputBox] Ctrl+P pressed, opening CommandDialog");
                  e.preventDefault();
                  dialog.replace(() => <CommandDialog />, { title: "Commands" });
                  return;
                }

                // 先让 CommandPalette 处理
                if (commandPalette?.onKeyDown(e.name || e.key)) {
                  e.preventDefault();
                  return;
                }

                // CommandPalette 不处理时
                if (e.name === "return" || e.key === "Enter") {
                  handleSubmit();
                }
              }}
              onSubmit={handleSubmit}
              placeholder={store.isStreaming() ? "AI is thinking..." : "Type / for commands..."}
              focused={true}
            />
          </box>
          <box flexDirection="row" flexShrink={0} marginLeft={1} alignItems="center">
            <text fg={theme.theme().muted}>ctrl+p cmds</text>
            <text fg={theme.theme().muted}> · </text>
            <text fg={theme.theme().muted}>/ commands</text>
          </box>
        </box>

        {/* 下行：模型信息 */}
        <box
          flexDirection="row"
          alignItems="center"
          paddingLeft={1}
          paddingRight={1}
          paddingTop={0}
          paddingBottom={0}
          marginTop={1}
          height={1}
        >
          <box flexDirection="row" alignItems="center" flexShrink={0}>
            <text fg={theme.theme().primary}>Build </text>
            <text fg={theme.theme().foreground}>{modelLabel()} </text>
            <text fg={theme.theme().primary}>Free</text>
            <text fg={theme.theme().foreground}> OpenCode Zen</text>
          </box>
          <Show when={store.isStreaming()}>
            <box flexDirection="row" alignItems="center" marginLeft={1}>
              <For each={Array.from({ length: STREAMING_DOT_COUNT }, (_, i) => i)}>
                {(i) => (
                  <text fg={streamingDotIndex() === i ? theme.theme().error : theme.theme().muted}>
                    {streamingDotIndex() === i ? "●" : "·"}
                  </text>
                )}
              </For>
              <text fg={theme.theme().muted}> esc interrupt</text>
            </box>
          </Show>
        </box>
      </box>
    </box>
  );
}
