/**
 * @fileoverview App 主组件
 * 
 * TUI 应用的主入口，根据 view 状态渲染首页或聊天页面
 */

import { onMount, createSignal, createContext, useContext, type Accessor, type Setter, Show, createEffect } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { Header } from "./Header.js";
import { MessageList } from "./MessageList.js";
import { InputBox } from "./InputBox.js";
import { DialogStack } from "./DialogStack.js";
import { HomeScreen } from "./HomeScreen.js";
import { useStore, useEventStream } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";

interface AppProps {
  sessionId?: string;
  onExit?: () => void;
}

const [rendererInstance, setRendererInstance] = createSignal<ReturnType<typeof useRenderer> | null>(null);

function RendererCapture() {
  const renderer = useRenderer();
  setRendererInstance(renderer);
  return null;
}

export function getRenderer() {
  return rendererInstance();
}

export function App(props: AppProps) {
  const store = useStore();
  const eventStream = useEventStream();

  // 处理 pending user query（从首页切换到聊天时）
  createEffect(() => {
    if (store.view() === "chat" && store.pendingUserQuery()) {
      const query = store.pendingUserQuery();
      if (query) {
        tuiLogger.info("[App] Processing pending user query", { query: query.substring(0, 50) });
        // 清除 pending query
        store.setPendingUserQuery(null);
        // 创建 session 并发送 prompt
        eventStream.createSession().then((sessionId) => {
          store.setSessionId(sessionId);
          eventStream.connect().then(() => {
            eventStream.sendPrompt(query);
          });
        });
      }
    }
  });

  onMount(async () => {
    // 如果传入了 sessionId，直接进入聊天模式
    if (props.sessionId) {
      store.setSessionId(props.sessionId);
      await eventStream.loadMessages(props.sessionId);
      store.setView("chat");
      await eventStream.connect();
    } else {
      // 没有 sessionId，进入首页
      store.setView("home");
    }
  });

  return (
    <>
      <RendererCapture />
      <box flexDirection="column" width="100%" height="100%">
        <Show when={store.view() === "chat"}>
          <Header />
          <box flexGrow={1} minHeight={0} overflow="hidden">
            <MessageList />
          </box>
          <InputBox onExit={props.onExit} />
        </Show>
        <Show when={store.view() === "home"}>
          <HomeScreen onExit={props.onExit} />
        </Show>
        {/* Dialog 栈渲染 */}
        <DialogStack />
      </box>
    </>
  );
}
