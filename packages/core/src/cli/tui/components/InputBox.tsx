/**
 * @fileoverview InputBox 组件
 * 
 * 用户输入框，支持多行输入和提交
 */

import { createSignal, Show } from "solid-js";
import { useStore, useEventStream } from "../contexts/index.js";

export function InputBox() {
  const store = useStore();
  const eventStream = useEventStream();
  
  const [input, setInput] = createSignal("");
  const [isSubmitting, setIsSubmitting] = createSignal(false);

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

  return (
    <box flexDirection="column" padding={1} borderStyle="single">
      <box flexDirection="row" marginBottom={1}>
        <text>{">"}</text>
        <text> Type your message (Enter to send, Ctrl+C to exit)</text>
      </box>

      <box flexDirection="row" alignItems="center">
        <text>❯ </text>
        <input
          flexGrow={1}
          value={input()}
          onChange={(value: string) => setInput(value)}
          onSubmit={handleSubmit}
          placeholder={store.isStreaming() ? "AI is thinking..." : "Type here..."}
          focused={true}
        />
      </box>

      <box flexDirection="row" justifyContent="space-between" marginTop={1}>
        <text>
          <Show when={store.isStreaming()}>⏳ AI is generating...</Show>
          <Show when={!store.isStreaming()}>Ready</Show>
        </text>
        <text>{input().length} chars</text>
      </box>
    </box>
  );
}
