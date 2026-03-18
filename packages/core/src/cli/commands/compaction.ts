/**
 * @fileoverview Compaction Command
 *
 * tong_work compaction 命令 - 管理 session 压缩
 */

import { CommandModule } from "yargs";
import { Config_get } from "../../config/index.js";

interface CompactionOptions {
  type: "help" | "status" | "compact";
  sessionId?: string;
}

export const CompactionCommand: CommandModule<object, CompactionOptions> = {
  command: "compaction [options]",
  describe: "Manage session compaction (status, trigger compaction)",

  builder: (yargs) =>
    yargs
      .option("type", {
        alias: "t",
        describe: "Action type",
        choices: ["status", "compact", "help"],
        default: "help",
      })
      .option("session-id", {
        alias: "s",
        describe: "Session ID",
        type: "string",
      }),

  async handler(argv) {
    const action = argv.type;
    const sessionId = argv.sessionId;

    if (action === "help") {
      console.log(`
Compaction Command Help
=======================

Usage:
  tong_work compaction --type status --session-id <id>
  tong_work compaction --type compact --session-id <id>

Options:
  --type, -t        Action type: status, compact, help
  --session-id, -s  Session ID

Examples:
  # Get compaction status
  tong_work compaction --type status --session-id default

  # Trigger compaction (requires running server)
  tong_work compaction --type compact --session-id default
      `);
      return;
    }

    if (!sessionId) {
      console.error("Error: --session-id is required");
      process.exit(1);
    }

    console.log(`Session ID: ${sessionId}`);
    console.log(`Action: ${action}`);
    console.log("\nNote: Compaction commands require a running server.");
    console.log("Use tong_work run to interact with sessions and trigger automatic compaction.");
  },
};

export default CompactionCommand;
