/**
 * @fileoverview Command Context - Command 管理上下文
 *
 * 管理 Command 列表、执行和 Command Palette 状态
 */

import { createContext, useContext, createSignal, batch } from "solid-js";
import type { Accessor, Setter } from "solid-js";
import { tuiLogger } from "../logger.js";
import { useStore } from "./store.js";

// ============================================================================
// 类型定义
// ============================================================================

export interface CommandItem {
  name: string;
  displayName?: string;
  description: string;
  hasArgs?: boolean;
  argsDescription?: string;
}

export interface CommandContextValue {
  // State
  commands: Accessor<CommandItem[]>;
  isOpen: Accessor<boolean>;
  selectedCommand: Accessor<CommandItem | null>;
  isExecuting: Accessor<boolean>;
  lastResult: Accessor<CommandResult | null>;

  // Setters
  setCommands: Setter<CommandItem[]>;
  setIsOpen: Setter<boolean>;
  setSelectedCommand: Setter<CommandItem | null>;
  setIsExecuting: Setter<boolean>;
  setLastResult: Setter<CommandResult | null>;

  // Actions
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  selectCommand: (command: CommandItem | null) => void;
  executeCommand: (name: string, args?: string) => Promise<CommandResult>;
  refreshCommands: () => Promise<void>;
  getCommandByName: (name: string) => CommandItem | undefined;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: unknown;
}

// ============================================================================
// Context 定义
// ============================================================================

const CommandContext = createContext<CommandContextValue>();

// ============================================================================
// Provider 组件
// ============================================================================

export function CommandProvider(props: {
  children: any;
  serverUrl: string;
}) {
  const store = useStore();
  
  // State
  const [commands, setCommands] = createSignal<CommandItem[]>([]);
  const [isOpen, setIsOpen] = createSignal(false);
  const [selectedCommand, setSelectedCommand] = createSignal<CommandItem | null>(null);
  const [isExecuting, setIsExecuting] = createSignal(false);
  const [lastResult, setLastResult] = createSignal<CommandResult | null>(null);

  // API 调用辅助函数
  const apiCall = async (endpoint: string, options?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    return fetch(`${props.serverUrl}${endpoint}`, {
      ...options,
      headers: { ...headers, ...(options?.headers as Record<string, string> || {}) },
    });
  };

  // 从服务器加载 Command 列表
  const refreshCommands = async (): Promise<void> => {
    try {
      tuiLogger.info("[CommandContext] Refreshing commands from server");
      const response = await apiCall("/commands");

      if (!response.ok) {
        throw new Error(`Failed to fetch commands: ${response.status}`);
      }

      const cmds = await response.json() as CommandItem[];
      batch(() => {
        setCommands(cmds);
      });

      tuiLogger.info("[CommandContext] Commands loaded", { count: cmds.length });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      tuiLogger.error("[CommandContext] Failed to refresh commands", { error: errorMessage });
    }
  };

  // 打开 Command Palette
  const openPalette = () => {
    tuiLogger.info("[CommandContext] Opening command palette called");
    try {
      setIsOpen(true);
      tuiLogger.info("[CommandContext] Palette state set to open");
      // 加载最新的命令列表
      refreshCommands();
    } catch (err) {
      tuiLogger.error("[CommandContext] Error in openPalette", { error: String(err) });
    }
  };

  // 关闭 Command Palette
  const closePalette = () => {
    tuiLogger.info("[CommandContext] Closing command palette");
    setIsOpen(false);
    setSelectedCommand(null);
  };

  // 切换 Command Palette
  const togglePalette = () => {
    if (isOpen()) {
      closePalette();
    } else {
      openPalette();
    }
  };

  // 选择 Command
  const selectCommand = (command: CommandItem | null) => {
    setSelectedCommand(command);
  };

  // 根据名称获取 Command
  const getCommandByName = (name: string): CommandItem | undefined => {
    return commands().find(cmd => cmd.name === name);
  };

  // 执行 Command
  const executeCommand = async (name: string, args?: string): Promise<CommandResult> => {
    tuiLogger.info("[CommandContext] Executing command", { name, args });

    batch(() => {
      setIsExecuting(true);
      setLastResult(null);
    });

    try {
      const response = await apiCall(`/commands/${encodeURIComponent(name)}`, {
        method: "POST",
        body: JSON.stringify({
          sessionId: store.sessionId() ?? undefined,
          args: args || "",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
        throw new Error(errorData.error || `Command failed: ${response.status}`);
      }

      const result = await response.json() as CommandResult;

      batch(() => {
        setLastResult(result);
        setIsExecuting(false);
      });

      tuiLogger.info("[CommandContext] Command executed successfully", {
        name,
        success: result.success,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorResult: CommandResult = {
        success: false,
        message: errorMessage,
      };

      batch(() => {
        setLastResult(errorResult);
        setIsExecuting(false);
      });

      tuiLogger.error("[CommandContext] Command execution failed", {
        name,
        error: errorMessage,
      });

      return errorResult;
    }
  };

  const value: CommandContextValue = {
    commands,
    isOpen,
    selectedCommand,
    isExecuting,
    lastResult,
    setCommands,
    setIsOpen,
    setSelectedCommand,
    setIsExecuting,
    setLastResult,
    openPalette,
    closePalette,
    togglePalette,
    selectCommand,
    executeCommand,
    refreshCommands,
    getCommandByName,
  };

  return (
    <CommandContext.Provider value={value}>
      {props.children}
    </CommandContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useCommand(): CommandContextValue {
  const context = useContext(CommandContext);
  if (!context) {
    throw new Error("useCommand must be used within a CommandProvider");
  }
  return context;
}

export type { CommandContext };
