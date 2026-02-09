/**
 * @fileoverview Header 组件
 * 
 * 显示应用标题、会话信息和状态
 */

import { useStore } from "../contexts/index.js";

export function Header() {
  const store = useStore();

  const sessionDisplay = () => {
    const id = store.sessionId();
    if (!id) return "No Session";
    return `${id.slice(0, 8)}...`;
  };

  const statusText = () => {
    if (store.isStreaming()) return "⏳ Generating...";
    if (store.isConnected()) return "🟢 Connected";
    return "⚪ Disconnected";
  };

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      padding={1}
      borderStyle="single"
    >
      <text>🤖 Tong Work</text>
      <text>Session: {sessionDisplay()}</text>
      <text>{statusText()}</text>
    </box>
  );
}
