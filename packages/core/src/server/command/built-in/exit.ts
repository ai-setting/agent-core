import type { Command, CommandContext, CommandResult } from "../types.js";
import { publishGlobal } from "../../eventbus/global.js";

export const exitCommand: Command = {
  name: "exit",
  displayName: "Exit",
  description: "Exit the application",
  hasArgs: false,

  async execute(context: CommandContext, _args: string): Promise<CommandResult> {
    publishGlobal(context.sessionId, "application.exit", {
      message: "User requested exit",
    });

    return {
      success: true,
      message: "Goodbye!",
      data: {
        mode: "exit",
      },
    };
  },
};
