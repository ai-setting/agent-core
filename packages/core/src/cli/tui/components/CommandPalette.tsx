/**
 * @fileoverview CommandPalette 组件 - OpenCode 风格实现
 * 
 * 独立组件，通过 ref 暴露 onInput 和 onKeyDown 方法
 */

import { createEffect, Show, For, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { useTheme, useCommand, useStore } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";
import type { CommandItem } from "../contexts/command.js";
import type { TextareaRenderable } from "@opentui/core";

export interface CommandPaletteRef {
  onInput: (value: string, textarea: TextareaRenderable) => void;
  onKeyDown: (key: string) => boolean;
  visible: boolean;
}

interface CommandPaletteProps {
  /** ref 回调 */
  ref: (ref: CommandPaletteRef) => void;
  /** 选择命令时的回调（用于需要参数的命令） */
  onSelectCommand?: (cmdName: string) => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  const theme = useTheme();
  const command = useCommand();
  const store = useStore();

  // 使用 createStore 管理状态
  const [state, setState] = createStore({
    visible: false,
    selected: 0,
    index: 0, // 触发字符的位置
    filter: "",
  });

  // 过滤后的命令列表
  const filteredCommands = () => {
    // 去掉 filter 中的换行符和空格
    const filter = state.filter.replace(/[\n\s]/g, "").toLowerCase();
    const cmds = command.commands();
    
    tuiLogger.info("[CommandPalette] filteredCommands", {
      filter,
      commandCount: cmds.length,
      commands: cmds.map(c => c.name)
    });
    
    if (!filter) {
      return cmds;
    }
    
    return cmds.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(filter) ||
        cmd.description.toLowerCase().includes(filter) ||
        (cmd.displayName && cmd.displayName.toLowerCase().includes(filter))
    );
  };

  // 当过滤条件变化时重置选中索引
  createEffect(() => {
    state.filter;
    setState("selected", 0);
  });

  // 显示面板
  const show = () => {
    tuiLogger.info("[CommandPalette] Show - loading commands if needed");
    // 加载命令
    if (command.commands().length === 0) {
      tuiLogger.info("[CommandPalette] No commands, refreshing...");
      command.refreshCommands().then(() => {
        tuiLogger.info("[CommandPalette] Commands refreshed", { count: command.commands().length });
      });
    }
    setState("visible", true);
  };

  // 隐藏面板
  const hide = () => {
    tuiLogger.info("[CommandPalette] Hide - resetting all state");
    setState({
      visible: false,
      selected: 0,
      index: 0,
      filter: "",
    });
  };

  // 移动选择
  const move = (direction: -1 | 1) => {
    const cmds = filteredCommands();
    if (cmds.length === 0) return;
    
    let next = state.selected + direction;
    if (next < 0) next = cmds.length - 1;
    if (next >= cmds.length) next = 0;
    setState("selected", next);
  };

  // 选择命令
  const select = () => {
    const cmds = filteredCommands();
    if (cmds.length === 0) return;
    
    const selectedCmd = cmds[state.selected];
    hide();
    handleCommandSelect(selectedCmd);
  };

  // 处理命令选择
  const handleCommandSelect = (cmd: CommandItem) => {
    tuiLogger.info("[CommandPalette] Command selected", { name: cmd.name, hasArgs: cmd.hasArgs });
    
    // 无论是否需要参数，都先隐藏面板
    hide();
    
    if (cmd.hasArgs) {
      // 需要参数：通知父组件插入命令名
      if (props.onSelectCommand) {
        props.onSelectCommand(cmd.name);
      }
    } else {
      // 不需要参数：直接执行
      executeCommand(cmd.name, "");
    }
  };

  // 执行命令
  const executeCommand = async (name: string, args: string) => {
    const result = await command.executeCommand(name, args);
    
    if (result.success) {
      store.addMessage({
        id: `cmd-result-${Date.now()}`,
        role: "system",
        content: `✓ /${name}: ${result.message || "Executed successfully"}`,
        timestamp: Date.now(),
      });
    } else {
      store.addMessage({
        id: `cmd-error-${Date.now()}`,
        role: "system",
        content: `✗ /${name} failed: ${result.message || "Unknown error"}`,
        timestamp: Date.now(),
      });
    }
  };

  // onInput - 处理输入变化
  const onInput = (value: string, textarea: TextareaRenderable) => {
    tuiLogger.info("[CommandPalette] onInput called", { 
      value, 
      visible: state.visible,
      hasTextarea: !!textarea,
      cursorOffset: textarea?.cursorOffset 
    });

    const cursorOffset = textarea?.cursorOffset || 0;
    
    // 去掉开头的换行符和空格后再检查
    const trimmedValue = value.replace(/^[\n\s]+/, "");
    const startsWithSlash = trimmedValue.startsWith("/");
    
    // 检查光标前是否有空白（考虑换行符的情况）
    const textBeforeCursor = value.slice(0, cursorOffset);
    const lastCharBeforeCursor = textBeforeCursor.replace(/[\n\s]+$/, "").slice(-1);
    const noWhitespaceBeforeCursor = !lastCharBeforeCursor.match(/\s/);
    
    // 检查是否已经输入了空格（命令+参数模式），此时不应显示 palette
    const hasSpaceInCommand = trimmedValue.match(/^\/[^\s]+\s/);

    // 检查是否满足显示条件（以 / 开头、光标前无空格、且没有输入空格分隔参数）
    const shouldShow = startsWithSlash && noWhitespaceBeforeCursor && !hasSpaceInCommand;
    
    tuiLogger.info("[CommandPalette] Checking conditions", {
      originalValue: JSON.stringify(value),
      trimmedValue: JSON.stringify(trimmedValue),
      startsWithSlash,
      noWhitespaceBeforeCursor,
      hasSpaceInCommand: !!hasSpaceInCommand,
      cursorOffset,
      shouldShow
    });

    if (state.visible) {
      // 如果当前可见，检查是否需要隐藏或更新
      const textBetween = textarea.getTextRange(state.index, cursorOffset);
      const shouldHide = cursorOffset <= state.index || 
                        textBetween.match(/\s/) ||
                        (trimmedValue.match(/^\/[^\s]*\s+\S/) && cursorOffset > trimmedValue.indexOf(' ') + 1);
      
      if (shouldHide) {
        tuiLogger.info("[CommandPalette] Hiding due to conditions");
        hide();
      } else {
        // 更新过滤条件 - 使用去掉开头换行符的值
        const filterText = trimmedValue.slice(state.index + 1, cursorOffset);
        tuiLogger.info("[CommandPalette] Updating filter", { filterText });
        setState("filter", filterText);
      }
      // 注意：即使面板可见，如果输入重置为空后再输入 /，也要允许重新显示
      // 所以这里不直接 return，而是在下面再次检查
      if (!shouldHide) return;
    }

    // 当前不可见，检查是否需要显示
    if (shouldShow) {
      tuiLogger.info("[CommandPalette] Showing palette");
      show();
      setState("index", 0);
      // 使用去掉开头换行符后的值来计算 filter
      setState("filter", trimmedValue.slice(1));
    }
  };

  // onKeyDown - 处理键盘事件
  const onKeyDown = (key: string): boolean => {
    tuiLogger.info("[CommandPalette] onKeyDown called", { 
      key, 
      visible: state.visible,
      commandCount: command.commands().length
    });

    if (!state.visible) {
      tuiLogger.info("[CommandPalette] Not visible, returning false");
      return false;
    }

    const lowerKey = key.toLowerCase();
    tuiLogger.info("[CommandPalette] Processing key", { lowerKey });

    switch (lowerKey) {
      case "up":
        tuiLogger.info("[CommandPalette] Moving up");
        move(-1);
        return true;
      case "down":
        tuiLogger.info("[CommandPalette] Moving down");
        move(1);
        return true;
      case "return":
      case "enter":
        const cmds = filteredCommands();
        if (cmds.length > 0) {
          tuiLogger.info("[CommandPalette] Selecting");
          select();
          return true;
        } else {
          tuiLogger.info("[CommandPalette] No commands to select, hiding");
          hide();
          return false; // 让 Enter 键继续传递，以便提交表单
        }
      case "escape":
        tuiLogger.info("[CommandPalette] Hiding via escape");
        hide();
        return true;
      default:
        tuiLogger.info("[CommandPalette] Unhandled key", { key: lowerKey });
        return false;
    }
  };

  // 暴露方法给父组件
  onMount(() => {
    tuiLogger.info("[CommandPalette] onMount - exposing ref methods");
    props.ref({
      get visible() {
        return state.visible;
      },
      onInput,
      onKeyDown,
    });
    tuiLogger.info("[CommandPalette] Ref methods exposed");
  });

  return (
    <Show when={state.visible}>
      <box
        position="absolute"
        bottom={5}
        left={1}
        right={1}
        maxHeight={15}
        flexDirection="column"
        borderStyle="single"
        borderColor={theme.theme().primary}
        backgroundColor={theme.theme().background}
        overflow="scroll"
      >
        {/* 标题 */}
        <box flexDirection="row" paddingLeft={1} paddingRight={1} height={1} marginBottom={1}>
          <text fg={theme.theme().primary}>Commands</text>
          <text fg={theme.theme().muted}> ({filteredCommands().length})</text>
        </box>

        {/* 命令列表 */}
        <box flexDirection="column">
          <Show
            when={filteredCommands().length > 0}
            fallback={
              <box flexDirection="row" paddingLeft={1} paddingRight={1} height={2}>
                <text fg={theme.theme().muted}>Loading commands...</text>
              </box>
            }
          >
            <For each={filteredCommands()}>
              {(cmd, index) => (
                <box
                  flexDirection="row"
                  alignItems="center"
                  paddingLeft={1}
                  paddingRight={1}
                  height={2}
                  backgroundColor={
                    index() === state.selected ? theme.theme().primary : undefined
                  }
                >
                  <box flexDirection="column" flexGrow={1}>
                    <box flexDirection="row">
                      <text
                        fg={
                          index() === state.selected
                            ? theme.theme().background
                            : theme.theme().primary
                        }
                      >
                        /{cmd.name}
                      </text>
                      <Show when={cmd.hasArgs}>
                        <text
                          fg={
                            index() === state.selected
                              ? theme.theme().background
                              : theme.theme().muted
                          }
                        >
                          {" "}
                          {cmd.argsDescription || "<args>"}
                        </text>
                      </Show>
                    </box>
                    <text
                      fg={
                        index() === state.selected
                          ? theme.theme().background
                          : theme.theme().muted
                      }
                    >
                      {cmd.description}
                    </text>
                  </box>
                </box>
              )}
            </For>
          </Show>
        </box>

        {/* 提示 */}
        <box flexDirection="row" paddingLeft={1} paddingRight={1} marginTop={1}>
          <text fg={theme.theme().muted}>
            ↑↓ select • Enter execute • Esc close
          </text>
        </box>
      </box>
    </Show>
  );
}
