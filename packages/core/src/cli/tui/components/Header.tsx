/**
 * @fileoverview Header 组件
 *
 * 顶部单行：应用名、会话与连接状态，简洁样式
 */

import { useStore, useTheme } from "../contexts/index.js";

export function Header() {
  const store = useStore();
  const theme = useTheme();

  const sessionDisplay = () => {
    const id = store.sessionId();
    if (!id) return "No Session";
    return `${id.slice(0, 8)}...`;
  };

  const statusText = () => {
    if (store.isStreaming()) return "Generating...";
    if (store.isConnected()) return "Connected";
    return "Disconnected";
  };

  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0}
      paddingBottom={0}
      height={1}
      borderStyle="single"
      borderColor={theme.theme().border}
    >
      <text fg={theme.theme().foreground}>Tong Work</text>
      <text fg={theme.theme().muted}>Session: {sessionDisplay()}</text>
      <text fg={theme.theme().muted}>{statusText()}</text>
    </box>
  );
}
