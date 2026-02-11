/**
 * @fileoverview Echo Command - 测试用内置命令
 *
 * 用于测试 Command 机制是否正常工作
 */

import type { Command, CommandContext, CommandResult } from "../types.js";

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

    return {
      success: true,
      message: input,
      data: { echoed: input, sessionId: context.sessionId },
    };
  },
};
