/**
 * @fileoverview MessageList 组件
 *
 * 展示对话列表：用户消息左侧蓝色竖条，助手消息含 Thinking 与流式 Markdown 回复，底部显示模型与耗时
 */

import { For, Show, createMemo } from "solid-js";
import type { Accessor } from "solid-js";
import type { SyntaxStyle } from "@opentui/core";
import { useStore, useTheme, useMarkdownStyle } from "../contexts/index.js";

function UserMessage(props: { content: string }) {
  const theme = useTheme();

  return (
    <box flexDirection="row" alignItems="flex-start" marginBottom={1}>
      <box
        width={1}
        flexShrink={0}
        alignSelf="stretch"
        backgroundColor={theme.theme().primary}
        marginRight={2}
      />
      <box flexGrow={1} paddingTop={0} paddingBottom={0}>
        <text fg={theme.theme().foreground}>{props.content}</text>
      </box>
    </box>
  );
}

function AssistantMessage(props: { message: any }) {
  const store = useStore();
  const theme = useTheme();
  const { syntaxStyle } = useMarkdownStyle();

  const parts = () => store.parts()[props.message.id] || [];
  const reasoningParts = () => parts().filter((p: any) => p.type === "reasoning");
  const textParts = () => parts().filter((p: any) => p.type === "text");
  const isLastMessage = () =>
    store.messages().length > 0 &&
    props.message.id === store.messages()[store.messages().length - 1]?.id;

  const displayContent = createMemo(() => {
    const texts = textParts().map((p: any) => p.content || "").join("");
    if (texts) return texts;
    return props.message.content || "";
  });

  const isStreamingThis = () => store.isStreaming() && isLastMessage();

  // Use a ref to store the raw SyntaxStyle instance to avoid SolidJS reactivity wrapping
  let rawSyntaxStyleRef: SyntaxStyle | null = null;

  /** Only use markdown when we have a real SyntaxStyle instance (has getStyle). */
  const validSyntaxStyle = createMemo(() => {
    const style = syntaxStyle();
    if (!style) {
      rawSyntaxStyleRef = null;
      return null;
    }
    // Check if getStyle exists and is a function (SyntaxStyle has getStyle(name: string): StyleDefinition | undefined)
    const hasGetStyle = typeof (style as unknown as { getStyle?: (name: string) => unknown }).getStyle === "function";
    if (!hasGetStyle) {
      rawSyntaxStyleRef = null;
      return null;
    }
    // Store the raw reference to bypass SolidJS reactivity
    rawSyntaxStyleRef = style;
    return style;
  });

  const modelLine = createMemo(() => {
    if (!isLastMessage()) return null;
    const model = store.lastModelName();
    const ms = store.lastResponseTimeMs();
    if (!model && ms == null) return null;
    const modelStr = model || "—";
    const timeStr = ms != null ? `${(ms / 1000).toFixed(1)}s` : "—";
    return { modelStr, timeStr };
  });

  return (
    <box flexDirection="column" marginBottom={2}>
      <Show when={reasoningParts().length > 0}>
        <box flexDirection="column" marginBottom={1}>
          <text fg={theme.theme().thinking}>Thinking:</text>
          <For each={reasoningParts()}>
            {(part: any) => (
              <box flexDirection="column" paddingLeft={2} marginTop={0}>
                <text fg={theme.theme().thinking}>
                  <i>{part.content || ""}</i>
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <box flexDirection="column" marginBottom={0}>
        <Show
          when={validSyntaxStyle()}
          fallback={
            <box flexDirection="column">
              <text fg={theme.theme().foreground}>
                {displayContent()}
                <Show when={isStreamingThis()}>
                  <span>▊</span>
                </Show>
              </text>
            </box>
          }
        >
          {(style: SyntaxStyle) => {
            // 使用 ref 中的原始对象，避免 SolidJS 响应式包装
            const rawStyle = rawSyntaxStyleRef || style;
            
            // 调试日志
            console.log("[MessageList] Rendering markdown:", {
              callbackParam: {
                type: typeof style,
                constructor: style?.constructor?.name,
                hasGetStyle: typeof style?.getStyle === "function",
              },
              rawRef: {
                type: typeof rawStyle,
                constructor: rawStyle?.constructor?.name,
                hasGetStyle: typeof rawStyle?.getStyle === "function",
              },
            });
            
            return (
              <box flexDirection="column">
                <markdown
                  content={displayContent()}
                  syntaxStyle={rawStyle}
                  streaming={isStreamingThis()}
                  conceal={false}
                />
                <Show when={isStreamingThis()}>
                  <text fg={theme.theme().foreground}>▊</text>
                </Show>
              </box>
            );
          }}
        </Show>
      </box>

      <For each={parts().filter((p: any) => p.type === "tool_call")}>
        {(part: any) => (
          <box flexDirection="column" marginTop={1} padding={1} borderStyle="single" borderColor={theme.theme().border}>
            <text fg={theme.theme().toolCall}>⚡ {part.toolName}</text>
            <Show when={part.toolArgs}>
              <text fg={theme.theme().muted}>
                {JSON.stringify(part.toolArgs, null, 2).slice(0, 100)}...
              </text>
            </Show>
          </box>
        )}
      </For>

      <For each={parts().filter((p: any) => p.type === "tool_result")}>
        {(part: any) => (
          <box flexDirection="column" marginTop={1} padding={1} borderStyle="single" borderColor={theme.theme().border}>
            <text fg={part.success ? theme.theme().success : theme.theme().error}>
              {part.success ? "✓" : "✗"} {part.toolName}
            </text>
            <text fg={theme.theme().muted}>
              {typeof part.result === "string"
                ? part.result.slice(0, 200)
                : JSON.stringify(part.result).slice(0, 200)}
            </text>
          </box>
        )}
      </For>

      <Show when={modelLine()}>
        {(line: Accessor<{ modelStr: string; timeStr: string }>) => (
          <box flexDirection="row" marginTop={1} alignItems="center">
            <text fg={theme.theme().muted}>■ Build · {line().modelStr} · {line().timeStr}</text>
          </box>
        )}
      </Show>
    </box>
  );
}

function MessageBubble(props: { message: any }) {
  const isUser = () => props.message.role === "user";
  const isAssistant = () => props.message.role === "assistant";

  return (
    <box flexDirection="column" marginLeft={1} marginRight={1} marginTop={1}>
      <Show when={isUser()}>
        <UserMessage content={props.message.content || ""} />
      </Show>
      <Show when={isAssistant()}>
        <AssistantMessage message={props.message} />
      </Show>
    </box>
  );
}

export function MessageList() {
  const store = useStore();

  return (
    <scrollbox flexGrow={1} padding={1} stickyScroll stickyStart="bottom">
      <Show
        when={store.messages().length > 0}
        fallback={
          <box justifyContent="center" alignItems="center" paddingTop={2}>
            <text fg="#6c757d">No messages yet. Start a conversation.</text>
          </box>
        }
      >
        <For each={store.messages()}>
          {(message) => <MessageBubble message={message} />}
        </For>
      </Show>

      <Show when={store.error()}>
        <box margin={1} padding={1} borderStyle="single" borderColor="#dc3545">
          <text fg="#dc3545">Error: {store.error()}</text>
        </box>
      </Show>
    </scrollbox>
  );
}
