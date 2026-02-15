import type { Command, CommandContext, CommandResult } from "../types.js";

export const exitCommand: Command = {
  name: "exit",
  displayName: "Exit",
  description: "Exit the application",
  hasArgs: false,

  async execute(_context: CommandContext, _args: string): Promise<CommandResult> {
    return {
      success: true,
      message: "Goodbye!",
      data: {
        mode: "exit",
      },
    };
  },
};
