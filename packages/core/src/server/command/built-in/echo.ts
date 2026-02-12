/**
 * @fileoverview Echo Command - 测试用内置命令
 *
 * 用于测试 Command 机制是否正常工作
 * 支持两种模式：
 * 1. 直接执行：args 为普通字符串，直接回显
 * 2. Dialog 模式：args 为 JSON {type: "dialog", message?: string}，返回需要显示对话框
 */

import type { Command, CommandContext, CommandResult } from "../types.js";

interface EchoAction {
  type: "dialog" | "echo";
  message?: string;
}

/**
 * Echo Command - 回显输入的消息
 */
export const echoCommand: Command = {
  name: "echo",
  displayName: "Echo",
  description: "Echo a message back (test command)",
  hasArgs: true,
  argsDescription: "message to echo",

  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    const input = args.trim();

    // 尝试解析为 JSON action
    let action: EchoAction | null = null;
    try {
      if (input.startsWith("{")) {
        action = JSON.parse(input) as EchoAction;
      }
    } catch {
      // 不是有效的 JSON，当作普通字符串处理
    }

    // Dialog 模式：返回需要打开对话框
    if (action?.type === "dialog") {
      return {
        success: true,
        message: "Opening echo dialog",
        data: { 
          mode: "dialog",
          defaultMessage: action.message || "",
        },
      };
    }

    // 普通模式：直接回显
    const message = action?.type === "echo" ? action.message : input;

    return {
      success: true,
      message: message || "",
      data: { 
        echoed: message || "", 
        sessionId: context.sessionId,
        mode: "direct",
      },
    };
  },
};
