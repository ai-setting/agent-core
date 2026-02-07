/**
 * @fileoverview Version Command
 *
 * 显示版本信息
 */

import { CommandModule } from "yargs";

export const VersionCommand: CommandModule = {
  command: "version",
  describe: "显示版本信息",
  handler: async () => {
    console.log("tong_work v0.1.0");
    console.log("");
    console.log("Agent Core - AI Native Enterprise Task Autonomous Advancement System");
  },
};
