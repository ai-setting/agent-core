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

function ReasoningMessage(props: { message: any }) {
  const store = useStore();
  const theme = useTheme();
  
  const parts = () => store.parts()[props.message.id] || [];
  const reasoningParts = () => parts().filter((p: any) => p.type === "reasoning");
  
  return (
    <box flexDirection="column" marginBottom={0} marginTop={0}>
      <text fg={theme.theme().thinking}>Thinking:</text>
      <For each={reasoningParts()}>
        {(part: any) => (
          <box flexDirection="column" paddingLeft={2} marginTop={0} marginBottom={0}>
            <text fg={theme.theme().thinking}>
              <i>{part.content || ""}</i>
            </text>
          </box>
        )}
      </For>
    </box>
  );
}

function ToolMessage(props: { message: any }) {
  const store = useStore();
  const theme = useTheme();
  
  const parts = () => store.parts()[props.message.id] || [];
  const toolResult = () => parts().find((p: any) => p.type === "tool_result");
  
  const content = props.message.content || "";
  const hasResult = content.includes("✓") || content.includes("✗");
  const isSuccess = content.includes("✓");
  
  return (
    <box flexDirection="row" alignItems="center" marginBottom={0}>
      <Show when={hasResult}>
        <text fg={isSuccess ? theme.theme().success : theme.theme().error}>
          {content}
        </text>
      </Show>
    </box>
  );
}

function AssistantMessage(props: { message: any }) {
  const store = useStore();
  const theme = useTheme();
  const { syntaxStyle } = useMarkdownStyle();

  const isLastMessage = () =>
    store.messages().length > 0 &&
    props.message.id === store.messages()[store.messages().length - 1]?.id;

  const displayContent = createMemo(() => props.message.content || "");
  const isStreamingThis = () => store.isStreaming() && isLastMessage();

  let rawSyntaxStyleRef: SyntaxStyle | null = null;

  const validSyntaxStyle = createMemo(() => {
    const style = syntaxStyle();
    if (!style) {
      rawSyntaxStyleRef = null;
      return null;
    }
    const hasGetStyle = typeof (style as unknown as { getStyle?: (name: string) => unknown }).getStyle === "function";
    if (!hasGetStyle) {
      rawSyntaxStyleRef = null;
      return null;
    }
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
            const rawStyle = rawSyntaxStyleRef || style;
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
  const isReasoning = () => typeof props.message.id === "string" && props.message.id.startsWith("reasoning-");
  const isTool = () => typeof props.message.id === "string" && props.message.id.startsWith("tool-");
  const isText = () => typeof props.message.id === "string" && props.message.id.startsWith("text-");
  const isAssistant = () => props.message.role === "assistant" && !isReasoning() && !isTool() && !isText();

  // Add spacing before text messages to separate from previous content
  const marginTop = () => isText() ? 1 : 0;

  return (
    <box flexDirection="column" marginLeft={1} marginRight={1} marginTop={marginTop()} marginBottom={0}>
      <Show when={isUser()}>
        <UserMessage content={props.message.content || ""} />
      </Show>
      <Show when={isReasoning()}>
        <ReasoningMessage message={props.message} />
      </Show>
      <Show when={isTool()}>
        <ToolMessage message={props.message} />
      </Show>
      <Show when={isText() || isAssistant()}>
        <AssistantMessage message={props.message} />
      </Show>
    </box>
  );
}

export function MessageList() {
  const store = useStore();

  return (
    <scrollbox width="100%" height="100%" padding={1} stickyScroll stickyStart="bottom">
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
