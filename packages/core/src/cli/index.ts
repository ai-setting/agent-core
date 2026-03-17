#!/usr/bin/env bun
/**
 * @fileoverview tong_work CLI - Entry Point
 *
 * tong_work CLI - AI原生企业任务自主推进系统
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

async function main() {
  const pkg = await import("../../package.json", { with: { type: "json" } });

  // 检查是否有 --quiet 参数（在导入命令之前设置）
  const args = process.argv.slice(2);
  const quietIndex = args.findIndex(arg => arg === '--quiet' || arg === '-q');
  if (quietIndex !== -1) {
    process.env.TONG_WORK_QUIET = "true";
  }

  // 动态导入命令模块
  const { VersionCommand } = await import("./commands/version.js");
  const { ServeCommand } = await import("./commands/serve.js");
  const { RunCommand } = await import("./commands/run.js");
  const { AttachCommand } = await import("./commands/attach.js");
  const { TuiCommand } = await import("./commands/tui.js");
  const { EnvCommand } = await import("./commands/env.js");

  await yargs(hideBin(process.argv))
    .scriptName("tong_work")
    .version(pkg.default.version)
    .usage("$0 <command> [args]")
    .command(TuiCommand)
    .command(VersionCommand)
    .command(ServeCommand)
    .command(RunCommand)
    .command(AttachCommand)
    .command(EnvCommand)
    .demandCommand()
    .strict()
    .help()
    .parse();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
