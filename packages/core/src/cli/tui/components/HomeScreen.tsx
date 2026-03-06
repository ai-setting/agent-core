/**
 * @fileoverview HomeScreen Component
 * 
 * 首页组件：展示 Logo、session 列表，复用 InputBox 组件
 */

import { createSignal, For, onMount, Show, createMemo } from "solid-js";
import { useStore, useEventStream } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";
import { InputBox } from "./InputBox.js";

interface SessionItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export function HomeScreen(props: { onExit?: () => void }) {
  const store = useStore();
  const eventStream = useEventStream();
  
  const [sessions, setSessions] = createSignal<SessionItem[]>([]);
  const [isLoading, setIsLoading] = createSignal(false);

  onMount(async () => {
    try {
      const list = await eventStream.listSessions();
      setSessions(list.slice(0, 10));
      tuiLogger.info(`[HomeScreen] Loaded ${list.length} sessions`);
    } catch (err) {
      tuiLogger.error("[HomeScreen] Failed to load sessions", { error: (err as Error).message });
    }
  });

  const handlePromptSubmit = async (content: string) => {
    setIsLoading(true);
    try {
      const newSessionId = await eventStream.createSession();
      store.setSessionId(newSessionId);
      store.setView("chat");
      await eventStream.connect();
      await eventStream.sendPrompt(content);
      tuiLogger.info(`[HomeScreen] Started new chat with prompt: ${content.substring(0, 50)}`);
    } catch (err) {
      tuiLogger.error("[HomeScreen] Failed to start chat", { error: (err as Error).message });
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) {
      return "Today";
    } else if (days === 1) {
      return "Yesterday";
    } else if (days < 7) {
      return `${days} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  return (
    <box 
      flexDirection="column" 
      width="100%" 
      height="100%" 
      justifyContent="center" 
      alignItems="center"
      backgroundColor="#0a0a0a"
    >
      {/* Logo 区域 */}
      <box marginBottom={4}>
        <text fg="#555555">tongwork</text>
      </box>

      {/* 输入框 - 复用 InputBox */}
      <box width="100%" maxWidth={80}>
        <InputBox onExit={props.onExit} onPromptSubmit={handlePromptSubmit} showModelInfo={false} />
      </box>

      {/* 操作栏 */}
      <box width={80} justifyContent="space-between" marginTop={1}>
        <text fg="#165dff">Build</text>
        <text fg="#999999">MiniMax-M2.5 MiniMax Coding Plan</text>
      </box>

      {/* Session 列表 - 只显示 title */}
      <Show when={sessions().length > 0}>
        <box 
          flexDirection="column" 
          width={80} 
          marginTop={4}
          maxHeight={10}
          borderStyle="single"
          borderColor="#333333"
        >
          <box padding={1}>
            <text fg="#ffffff">Recent Chats</text>
          </box>
          
          <box flexGrow={1} overflow="scroll">
            <For each={sessions()}>
              {(session) => (
                <box paddingX={1} paddingY={0} height={1}>
                  <text fg="#999999">› </text>
                  <text fg="#ffffff">{session.title || "Untitled"}</text>
                </box>
              )}
            </For>
          </box>
        </box>
      </Show>
    </box>
  );
}
