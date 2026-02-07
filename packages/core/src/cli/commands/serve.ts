/**
 * @fileoverview Serve Command
 *
 * 启动 headless tong_work 服务器
 */

import { CommandModule } from "yargs";

interface ServeOptions {
  port?: number;
  host?: string;
}

export const ServeCommand: CommandModule<object, ServeOptions> = {
  command: "serve",
  describe: "启动 headless tong_work 服务器",
  builder: (yargs) =>
    yargs
      .option("port", {
        describe: "服务器端口",
        type: "number",
        default: 4096,
      })
      .option("host", {
        describe: "服务器主机",
        type: "string",
        default: "localhost",
      }),

  async handler(args) {
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║     tong_work Server                                      ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log();
    console.log(`Server listening on http://${args.host}:${args.port}`);
    console.log();
    console.log("使用 bun 直接运行服务器:");
    console.log(`  cd agent-core/packages/app/server && bun run start`);
    console.log();
    console.log("或使用 bun run serve 启动:");
    console.log(`  bun run serve --port ${args.port} --host ${args.host}`);
    console.log();
    console.log("按 Ctrl+C 停止");
  },
};
