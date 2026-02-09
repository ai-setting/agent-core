/**
 * @fileoverview MessageList 组件
 * 
 * 显示消息列表，支持流式渲染
 */

import { For, Show, createSignal, createEffect } from "solid-js";
import { useStore } from "../contexts/index.js";

function MessageBubble(props: { message: any }) {
  const store = useStore();
  const [renderCount, setRenderCount] = createSignal(0);
  
  const isUser = () => props.message.role === "user";
  const isAssistant = () => props.message.role === "assistant";
  const parts = () => {
    const p = store.parts()[props.message.id] || [];
    console.log("[RENDER] MessageBubble parts accessed", { messageId: props.message.id, partsCount: p.length, parts: p.map((x: any) => ({ type: x.type, contentLength: x.content?.length })) });
    return p;
  };
  
  createEffect(() => {
    setRenderCount(c => c + 1);
    console.log("[RENDER] MessageBubble rendered", { 
      messageId: props.message.id, 
      role: props.message.role,
      contentLength: props.message.content?.length,
      contentPreview: props.message.content?.substring(0, 50),
      renderCount: renderCount(),
    });
  });

  return (
    <box
      flexDirection="column"
      margin={1}
      padding={1}
      borderStyle="single"
    >
      <box flexDirection="row" marginBottom={1}>
        <text>{isUser() ? "👤 You" : "🤖 Assistant"}</text>
        <text> {new Date(props.message.timestamp).toLocaleTimeString()}</text>
      </box>

      <Show when={isUser()}>
        <box>
          <text>{props.message.content}</text>
        </box>
      </Show>

      <Show when={isAssistant()}>
        <box flexDirection="column">
          <For each={parts().filter((p: any) => p.type === "reasoning")}>
            {(part: any) => (
              <box margin={0} paddingLeft={2}>
                <text>💭 {part.content}</text>
              </box>
            )}
          </For>

          <For each={parts().filter((p: any) => p.type === "text")}>
            {(part: any) => (
              <box>
                <text>{part.content}</text>
                <Show when={store.isStreaming() && props.message.id === store.messages()[store.messages().length - 1]?.id}>
                  <text>▊</text>
                </Show>
              </box>
            )}
          </For>

          <Show when={store.isStreaming() && props.message.id === store.messages()[store.messages().length - 1]?.id}>
            <box>
              <text>▊</text>
            </box>
          </Show>

          <For each={parts().filter((p: any) => p.type === "tool_call")}>
            {(part: any) => (
              <box flexDirection="column" margin={1} padding={1} borderStyle="single">
                <text>⚡ {part.toolName}</text>
                <Show when={part.toolArgs}>
                  <box>
                    <text>{JSON.stringify(part.toolArgs, null, 2).slice(0, 100)}...</text>
                  </box>
                </Show>
              </box>
            )}
          </For>

          <For each={parts().filter((p: any) => p.type === "tool_result")}>
            {(part: any) => (
              <box flexDirection="column" margin={1} padding={1} borderStyle="single">
                <text>{part.success ? "✓" : "✗"} {part.toolName}</text>
                <box>
                  <text>
                    {typeof part.result === "string" 
                      ? part.result.slice(0, 200)
                      : JSON.stringify(part.result).slice(0, 200)}
                  </text>
                </box>
              </box>
            )}
          </For>

          <Show when={props.message.content}>
            <box>
              <text>{props.message.content}</text>
            </box>
          </Show>

          <Show when={store.isStreaming() && props.message.id === store.messages()[store.messages().length - 1]?.id}>
            <box>
              <text>▊</text>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  );
}

export function MessageList() {
  const store = useStore();

  return (
    <scrollbox flexGrow={1} padding={1} borderStyle="single">
      <Show when={store.messages().length > 0} fallback={
        <box justifyContent="center" alignItems="center">
          <text>No messages yet. Start a conversation!</text>
        </box>
      }>
        <For each={store.messages()}>
          {(message) => <MessageBubble message={message} />}
        </For>
      </Show>
      
      <Show when={store.error()}>
        <box margin={1} padding={1} borderStyle="single">
          <text>❌ Error: {store.error()}</text>
        </box>
      </Show>
    </scrollbox>
  );
}
