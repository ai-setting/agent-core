/**
 * @fileoverview CommandDialog 组件 - 全屏命令选择器
 * 
 * 提供类似 OpenCode 的 DialogCommand 体验
 * - 全屏展示命令列表
 * - 支持搜索过滤
 * - 支持分组显示
 * - 键盘导航（上下、Enter、Esc）
 */

import { createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { useCommand, useDialog, useTheme, type CommandItem } from "../contexts/index.js";
import { tuiLogger } from "../logger.js";

export interface CommandDialogProps {
  /** 可选的过滤文本（预填充搜索框） */
  initialFilter?: string;
}

interface CommandGroup {
  name: string;
  commands: CommandItem[];
}

export function CommandDialog(props: CommandDialogProps) {
  const command = useCommand();
  const dialog = useDialog();
  const theme = useTheme();

  // 本地状态
  const [filter, setFilter] = createSignal(props.initialFilter || "");
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [store, setStore] = createStore({
    commands: [] as CommandItem[],
  });

  // 加载命令
  onMount(async () => {
    tuiLogger.info("[CommandDialog] Mounting, loading commands");
    await command.refreshCommands();
    setStore("commands", command.commands());
    tuiLogger.info("[CommandDialog] Commands loaded", { count: store.commands.length });
  });

  // 分组命令
  const commandGroups = createMemo((): CommandGroup[] => {
    const cmds = store.commands;
    const f = filter().toLowerCase().trim();

    // 过滤命令
    let filtered = cmds;
    if (f) {
      filtered = cmds.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(f) ||
          cmd.description.toLowerCase().includes(f) ||
          (cmd.displayName && cmd.displayName.toLowerCase().includes(f))
      );
    }

    // 按是否需要参数分组
    const withArgs = filtered.filter((c) => c.hasArgs);
    const withoutArgs = filtered.filter((c) => !c.hasArgs);

    const groups: CommandGroup[] = [];
    if (withoutArgs.length > 0) {
      groups.push({ name: "Quick Actions", commands: withoutArgs });
    }
    if (withArgs.length > 0) {
      groups.push({ name: "Commands with Arguments", commands: withArgs });
    }

    return groups;
  });

  // 扁平化的命令列表（用于键盘导航）
  const flatCommands = createMemo(() => {
    return commandGroups().flatMap((g) => g.commands);
  });

  // 当过滤条件变化时重置选中索引
  const updateFilter = (value: string) => {
    setFilter(value);
    setSelectedIndex(0);
  };

  // 移动选择
  const moveSelection = (direction: -1 | 1) => {
    const cmds = flatCommands();
    if (cmds.length === 0) return;

    let next = selectedIndex() + direction;
    if (next < 0) next = cmds.length - 1;
    if (next >= cmds.length) next = 0;

    setSelectedIndex(next);
  };

  // 执行选中的命令
  const executeSelected = async () => {
    const cmds = flatCommands();
    tuiLogger.info("[CommandDialog] executeSelected called", { 
      flatCommandsLength: cmds.length,
      selectedIndex: selectedIndex()
    });
    
    if (cmds.length === 0) {
      tuiLogger.warn("[CommandDialog] No commands available");
      return;
    }

    const selectedCmd = cmds[selectedIndex()];
    if (!selectedCmd) {
      tuiLogger.warn("[CommandDialog] No command selected at index", { index: selectedIndex() });
      return;
    }

    tuiLogger.info("[CommandDialog] Executing command", { 
      name: selectedCmd.name, 
      hasArgs: selectedCmd.hasArgs,
      fullCommand: selectedCmd
    });

    if (selectedCmd.hasArgs) {
      // 需要参数：关闭 dialog 并在输入框插入命令
      tuiLogger.info("[CommandDialog] Command has args, popping dialog and executing");
      dialog.pop();
      // 直接执行（带空参数），TUI 环境不支持 CustomEvent
      await command.executeCommand(selectedCmd.name, "");
    } else {
      // 不需要参数：直接执行并显示结果
      tuiLogger.info("[CommandDialog] Command has no args, executing without popping first");
      
      // Execute command first
      tuiLogger.info("[CommandDialog] Executing command via API");
      const result = await command.executeCommand(selectedCmd.name, "");
      tuiLogger.info("[CommandDialog] Command executed", { success: result.success, name: selectedCmd.name, resultData: JSON.stringify(result.data) });
      
      // Check if result indicates dialog mode
      tuiLogger.info("[CommandDialog] Checking for dialog mode", { 
        hasData: !!result.data, 
        mode: (result.data as any)?.mode,
        dataKeys: result.data ? Object.keys(result.data as any) : []
      });
      
      if (result.success && result.data && (result.data as any).mode === "dialog") {
        // Open corresponding dialog based on command type - use replace instead of pop then push
        tuiLogger.info("[CommandDialog] Opening dialog for command", { name: selectedCmd.name });
        try {
          switch (selectedCmd.name) {
            case "models": {
              tuiLogger.info("[CommandDialog] Importing ModelsDialog...");
              const { ModelsDialog } = await import("./ModelsDialog.js");
              tuiLogger.info("[CommandDialog] ModelsDialog imported, calling replace");
              dialog.replace(() => <ModelsDialog data={(result.data as any)} />);
              tuiLogger.info("[CommandDialog] ModelsDialog replace called");
              break;
            }
            case "connect": {
              tuiLogger.info("[CommandDialog] Importing ConnectDialog...");
              const { ConnectDialog } = await import("./ConnectDialog.js");
              tuiLogger.info("[CommandDialog] ConnectDialog imported, calling replace");
              dialog.replace(() => <ConnectDialog />);
              tuiLogger.info("[CommandDialog] ConnectDialog replace called");
              break;
            }
            case "echo": {
              tuiLogger.info("[CommandDialog] Importing EchoDialog...");
              const { EchoDialog } = await import("./EchoDialog.js");
              tuiLogger.info("[CommandDialog] EchoDialog imported, calling replace");
              dialog.replace(() => <EchoDialog defaultMessage={(result.data as any).defaultMessage || ""} />);
              tuiLogger.info("[CommandDialog] EchoDialog replace called");
              break;
            }
            case "agent-env": {
              tuiLogger.info("[CommandDialog] Importing AgentEnvDialog...");
              const { AgentEnvDialog } = await import("./AgentEnvDialog.js");
              tuiLogger.info("[CommandDialog] AgentEnvDialog imported, calling replace");
              dialog.replace(() => <AgentEnvDialog data={(result.data as any)} />);
              tuiLogger.info("[CommandDialog] AgentEnvDialog replace called");
              break;
            }
            default:
              tuiLogger.info("[CommandDialog] Unknown dialog command, showing result");
              dialog.pop();
              showResultDialog(selectedCmd, result);
          }
        } catch (error) {
          tuiLogger.error("[CommandDialog] Error opening dialog", { error: String(error) });
          dialog.pop();
          showResultDialog(selectedCmd, { success: false, message: `Error opening dialog: ${error}` });
        }
      } else {
        // Show result dialog
        tuiLogger.info("[CommandDialog] Not a dialog command, popping and showing result");
        dialog.pop();
        showResultDialog(selectedCmd, result);
      }
    }
  };

  // 显示结果对话框
  const showResultDialog = (cmd: CommandItem, result: { success: boolean; message?: string }) => {
    tuiLogger.info("[CommandDialog] Opening result dialog for", { cmdName: cmd.name });
    
    dialog.push(
      () => (
        <CommandResultDialogContent 
          command={cmd} 
          result={result} 
          onClose={() => dialog.pop()}
          theme={{
            success: theme.theme().success,
            error: theme.theme().error,
            foreground: theme.theme().foreground,
            border: theme.theme().border,
            muted: theme.theme().muted,
          }}
        />
      ),
      { title: `Result: /${cmd.name}` }
    );
  };

  // 键盘事件处理
  const handleKeyDown = (key: string): boolean => {
    tuiLogger.info("[CommandDialog] handleKeyDown", { key });
    switch (key.toLowerCase()) {
      case "up":
      case "arrowup":
        moveSelection(-1);
        return true;
      case "down":
      case "arrowdown":
        moveSelection(1);
        return true;
      case "return":
      case "enter":
        tuiLogger.info("[CommandDialog] Enter key pressed, executing selected");
        executeSelected();
        return true;
      case "escape":
        tuiLogger.info("[CommandDialog] Escape key pressed, closing dialog");
        dialog.pop();
        return true;
      default:
        return false;
    }
  };

  // 键盘监听在 input 的 onKeyDown 中处理
  onMount(() => {
    tuiLogger.info("[CommandDialog] Mounted");
  });

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      {/* 搜索框 */}
      <box flexDirection="row" height={1} marginBottom={1}>
        <text fg={theme.theme().primary}>&gt; </text>
        <input
          flexGrow={1}
          value={filter()}
          onChange={updateFilter}
          placeholder="Search commands..."
          focused={true}
          onKeyDown={(e: any) => {
            if (handleKeyDown(e.name || e.key)) {
              e.preventDefault();
            }
          }}
        />
      </box>

      {/* 分隔线 */}
      <box height={1} borderStyle="single" borderColor={theme.theme().border} />

      {/* 命令列表 */}
      <box flexGrow={1} flexDirection="column" overflow="scroll" marginTop={1}>
        <Show
          when={flatCommands().length > 0}
          fallback={
            <box flexDirection="row" paddingLeft={1}>
              <text fg={theme.theme().muted}>No commands found</text>
            </box>
          }
        >
          <For each={commandGroups()}>
            {(group) => (
              <box flexDirection="column" marginBottom={1}>
                {/* 分组标题 */}
                <box
                  flexDirection="row"
                  height={1}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={theme.theme().border}
                >
                  <text fg={theme.theme().muted}>{group.name}</text>
                  <text fg={theme.theme().muted}> ({group.commands.length})</text>
                </box>

                {/* 分组命令 */}
                <For each={group.commands}>
                  {(cmd, index) => {
                    const globalIndex = flatCommands().indexOf(cmd);
                    const isSelected = () => globalIndex === selectedIndex();

                    return (
                      <box
                        flexDirection="row"
                        alignItems="center"
                        paddingLeft={2}
                        paddingRight={1}
                        height={1}
                        backgroundColor={isSelected() ? theme.theme().primary : undefined}
                      >
                        <text
                          fg={isSelected() ? theme.theme().background : theme.theme().primary}
                        >
                          /{cmd.name}
                        </text>
                        <Show when={cmd.hasArgs}>
                          <text
                            fg={isSelected() ? theme.theme().background : theme.theme().muted}
                          >
                            {" "}
                            {cmd.argsDescription || "<args>"}
                          </text>
                        </Show>
                        <box flexGrow={1} />
                        <text
                          fg={isSelected() ? theme.theme().background : theme.theme().muted}
                        >
                          {cmd.description}
                        </text>
                      </box>
                    );
                  }}
                </For>
              </box>
            )}
          </For>
        </Show>
      </box>

      {/* 底部提示 */}
      <box flexDirection="row" height={1} marginTop={1}>
        <text fg={theme.theme().muted}>
          ↑↓ navigate • Enter execute • Esc close • {flatCommands().length} commands
        </text>
      </box>
    </box>
  );
}

// ============================================================================
// Command Result Dialog Content
// ============================================================================

interface CommandResultDialogContentProps {
  command: CommandItem;
  result: { success: boolean; message?: string };
  onClose: () => void;
  theme: { success: string; error: string; foreground: string; border: string; muted: string };
}

export function CommandResultDialogContent(props: CommandResultDialogContentProps) {
  onMount(() => {
    tuiLogger.info("[CommandResultDialog] Mounted", {
      command: props.command.name,
      success: props.result.success,
    });
  });

  return (
    <box flexDirection="column" padding={2} width="100%" height="100%">
      {/* 状态图标和消息 */}
      <box flexDirection="row" alignItems="center" height={1} marginBottom={1}>
        <text fg={props.result.success ? props.theme.success : props.theme.error}>
          {props.result.success ? "✓" : "✗"}
        </text>
        <text fg={props.theme.foreground} marginLeft={1}>
          {props.result.success ? "Success" : "Failed"}
        </text>
      </box>

      {/* 详细信息 */}
      <Show when={props.result.message}>
        <box
          flexDirection="column"
          padding={1}
          borderStyle="single"
          borderColor={props.theme.border}
          marginTop={1}
          flexGrow={1}
        >
          <text fg={props.theme.foreground}>{props.result.message}</text>
        </box>
      </Show>

      {/* 底部提示 */}
      <box flexDirection="row" height={1} marginTop={1}>
        <text fg={props.theme.muted}>Press Enter or Esc to close</text>
      </box>

      {/* 键盘监听由父组件 DialogStack 处理 */}
    </box>
  );
}
