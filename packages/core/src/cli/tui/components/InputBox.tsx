/**
 * @fileoverview InputBox 组件
 *
 * 上下两行：上行仅用于用户输入 query，下行显示模型等信息；
 * 流式传输时下行追加 “●···· esc interrupt” 指示器。
 */

import { createSignal, onCleanup, createEffect, Show, For } from "solid-js";
import { useStore, useEventStream, useTheme } from "../contexts/index.js";

const STREAMING_DOT_COUNT = 5;
const STREAMING_TICK_MS = 120;

export function InputBox() {
  const store = useStore();
  const eventStream = useEventStream();
  const theme = useTheme();

  const [input, setInput] = createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);
  const [streamingDotIndex, setStreamingDotIndex] = createSignal(0);

  createEffect(() => {
    if (!store.isStreaming()) return;
    setStreamingDotIndex(0);
    const id = setInterval(() => {
      setStreamingDotIndex((i) => (i + 1) % STREAMING_DOT_COUNT);
    }, STREAMING_TICK_MS);
    onCleanup(() => clearInterval(id));
  });

  const handleSubmit = async () => {
    const content = input().trim();
    if (!content || store.isStreaming() || isSubmitting()) return;

    setIsSubmitting(true);
    setInput("");

    try {
      await eventStream.sendPrompt(content);
    } catch (err) {
      console.error("Failed to send:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const modelLabel = () => store.lastModelName() || "OpenCode Zen";

  return (
    <box flexDirection="column" flexShrink={0} borderStyle="single" borderColor={theme.theme().border}>
      {/* 上行：用户输入 query */}
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
          <input
            flexGrow={1}
            value={input()}
            onChange={(value: string) => setInput(value)}
            onSubmit={handleSubmit}
            placeholder={store.isStreaming() ? "AI is thinking..." : "Type a message..."}
            focused={true}
          />
        </box>
        <box flexDirection="row" flexShrink={0} marginLeft={1} alignItems="center">
          <text fg={theme.theme().muted}>tab agents</text>
          <text fg={theme.theme().muted}> · </text>
          <text fg={theme.theme().muted}>ctrl+p commands</text>
          <text fg={theme.theme().muted}> · </text>
          <text fg={theme.theme().muted}>ctrl+e zst</text>
        </box>
      </box>

      {/* 下行：模型等信息，流式时显示指示器 */}
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
  );
}
