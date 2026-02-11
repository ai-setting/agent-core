/**
 * @fileoverview DialogStack 组件 - Dialog 栈渲染组件
 * 
 * 渲染当前 Dialog 栈，处理层级显示和背景遮罩
 */

import { Show } from "solid-js";
import { useDialog, useTheme, type DialogItem } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";

export interface DialogStackProps {
  /** 是否显示背景遮罩 */
  showOverlay?: boolean;
}

export function DialogStack(props: DialogStackProps) {
  const dialog = useDialog();
  const theme = useTheme();
  const showOverlay = () => props.showOverlay ?? true;

  tuiLogger.info("[DialogStack] Rendering", { 
    dialogCount: dialog.stack().length,
    isOpen: dialog.isOpen() 
  });

  return (
    <Show when={dialog.isOpen()}>
      {/* 背景遮罩 */}
      <Show when={showOverlay()}>
        <box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          backgroundColor={theme.theme().background}
          opacity={0.8}
          zIndex={100}
        />
      </Show>

      {/* Dialog 栈 - 只渲染栈顶，居中显示 */}
      <Show when={dialog.currentDialog()}>
        {(current: () => DialogItem) => (
          <box
            position="absolute"
            top="30%"
            left="20%"
            width="60%"
            height="40%"
            flexDirection="column"
            borderStyle="single"
            borderColor={theme.theme().primary}
            backgroundColor={theme.theme().background}
            zIndex={101}
          >
            {/* Dialog 标题栏 */}
            <Show when={current().title}>
              <box
                flexDirection="row"
                height={1}
                paddingLeft={1}
                paddingRight={1}
                borderStyle="single"
                borderColor={theme.theme().primary}
              >
                <text fg={theme.theme().primary}>{current().title}</text>
                <box flexGrow={1} />
                <text fg={theme.theme().muted}>ESC to close</text>
              </box>
            </Show>

            {/* Dialog 内容 - 使用固定高度防止增长 */}
            <box 
              flexDirection="column" 
              overflow="scroll"
              height="100%"
            >
              {current().element()}
            </box>
          </box>
        )}
      </Show>
    </Show>
  );
}
