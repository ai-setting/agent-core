/**
 * @fileoverview EchoDialog Component - Echo Command Dialog
 *
 * 提供交互式界面让用户输入消息并查看回显结果
 * 作为 Command + Dialog 完整链路的示例
 */

import { createSignal, Show, onMount } from "solid-js";
import { useCommand, useDialog, useTheme } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";

interface EchoDialogProps {
  /** 默认消息（可选） */
  defaultMessage?: string;
}

export function EchoDialog(props: EchoDialogProps) {
  const command = useCommand();
  const dialog = useDialog();
  const theme = useTheme();

  const [message, setMessage] = createSignal(props.defaultMessage || "");
  const [result, setResult] = createSignal<string | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  onMount(() => {
    tuiLogger.info("[EchoDialog] Mounted", { defaultMessage: props.defaultMessage });
  });

  const handleEcho = async () => {
    const msg = message().trim();
    
    tuiLogger.info("[EchoDialog] Echo requested", { messageLength: msg.length });

    if (!msg) {
      setError("Please enter a message");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await command.executeCommand(
        "echo",
        JSON.stringify({ type: "echo", message: msg })
      );

      if (result.success) {
        tuiLogger.info("[EchoDialog] Echo successful", { result: result.message, data: result.data });
        const resultMessage = result.message || "";
        tuiLogger.info("[EchoDialog] Setting result", { resultMessage });
        setResult(resultMessage);
        tuiLogger.info("[EchoDialog] Result set", { currentResult: resultMessage });
      } else {
        tuiLogger.error("[EchoDialog] Echo failed", { error: result.message });
        setError(result.message || "Echo failed");
      }
    } catch (err) {
      tuiLogger.error("[EchoDialog] Echo error", { error: String(err) });
      setError("Failed to execute echo");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    tuiLogger.info("[EchoDialog] Closing dialog");
    dialog.pop();
  };

  const handleKeyDown = (e: any) => {
    const key = e.name || e.key;
    tuiLogger.info("[EchoDialog] Key pressed", { key });

    switch (key.toLowerCase()) {
      case "escape":
        handleClose();
        return true;
      case "return":
      case "enter":
        if (!result()) {
          handleEcho();
        } else {
          handleClose();
        }
        return true;
      default:
        return false;
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%" padding={2}>
      {/* 标题 */}
      <box flexDirection="row" alignItems="center" height={1} marginBottom={1}>
        <text fg={theme.theme().foreground}>Echo</text>
        <box flexGrow={1} />
        <text fg={theme.theme().muted}>ESC to close</text>
      </box>

      <box height={1} borderStyle="single" borderColor={theme.theme().border} marginBottom={1} />

      {/* 输入区域 */}
      <Show when={!result()}>
        <box flexDirection="column" marginBottom={1}>
          <text fg={theme.theme().muted} marginBottom={1}>
            Enter a message to echo:
          </text>
          <input
            value={message()}
            onChange={(value: string) => {
              tuiLogger.info("[EchoDialog] Message changed", { length: value?.length || 0 });
              setMessage(value || "");
              setError(null);
            }}
            placeholder="Type your message here..."
            focused={true}
            onKeyDown={handleKeyDown}
          />
        </box>

        <Show when={error()}>
          <text fg={theme.theme().error} marginTop={1} marginBottom={1}>
            {error()}
          </text>
        </Show>

        <box flexDirection="row" height={1} marginTop={1}>
          <text fg={theme.theme().muted}>
            {isLoading() ? "Processing..." : "Enter to echo • Esc to close"}
          </text>
        </box>
      </Show>

      {/* 结果区域 */}
      <Show when={result()}>
        {(resultValue: () => string) => {
          tuiLogger.info("[EchoDialog] Rendering result", { resultValue: resultValue() });
          return (
            <box flexDirection="column">
              {/* 隐藏的 input 用于捕获键盘事件 */}
              <input
                width={0}
                value=""
                opacity={0}
                focused={true}
                onKeyDown={handleKeyDown}
              />
              
              <text fg={theme.theme().success} marginBottom={1}>
                ✓ Echo Result:
              </text>
              
              <box
                flexDirection="column"
                padding={1}
                borderStyle="single"
                borderColor={theme.theme().border}
                marginTop={1}
                marginBottom={1}
              >
                <text fg={theme.theme().foreground}>{resultValue()}</text>
              </box>

              <box flexDirection="row" height={1} marginTop={1}>
                <text fg={theme.theme().muted}>
                  Enter to close • Esc to close
                </text>
              </box>
            </box>
          );
        }}
      </Show>
    </box>
  );
}
