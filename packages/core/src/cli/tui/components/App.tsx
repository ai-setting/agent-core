/**
 * @fileoverview App 主组件
 * 
 * TUI 应用的主入口，组合所有子组件
 */

import { onMount } from "solid-js";
import { Header } from "./Header.js";
import { MessageList } from "./MessageList.js";
import { InputBox } from "./InputBox.js";
import { DialogStack } from "./DialogStack.js";
import { useStore, useEventStream } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";

interface AppProps {
  sessionId?: string;
  onExit?: () => void;
}

export function App(props: AppProps) {
  const store = useStore();
  const eventStream = useEventStream();

  onMount(async () => {
    try {
      if (props.sessionId) {
        store.setSessionId(props.sessionId);
        await eventStream.loadMessages(props.sessionId);
        await eventStream.connect();
      } else {
        const newSessionId = await eventStream.createSession();
        console.log(`Created new session: ${newSessionId}`);
        store.setSessionId(newSessionId);
        // 创建会话后连接事件流
        await eventStream.connect();
      }
    } catch (err) {
      store.setError((err as Error).message);
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%">
      <Header />
      <box flexGrow={1} minHeight={0} overflow="hidden">
        <MessageList />
      </box>
      <InputBox />
      {/* Dialog 栈渲染 */}
      <DialogStack />
    </box>
  );
}
