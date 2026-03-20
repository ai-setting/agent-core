#!/usr/bin/env bun
/**
 * @fileoverview tong_work CLI - Entry Point
 *
 * tong_work CLI - AI原生企业任务自主推进系统
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

const CLI_USAGE = `
tong_work - AI 原生企业任务自主推进系统

使用方法:
  tong_work [command] [options]

命令:
  tong_work             启动 TUI 交互界面（默认）
  tong_work run [msg]   直接运行代理任务
  tong_work serve       启动 headless 服务器
  tong_work attach <url>  附加到运行中的服务器
  tong_work env         环境管理
  tong_work version     显示版本信息

示例:
  tong_work run "帮我写一个 hello world"
  tong_work run "任务" --env dev --continue
  tong_work serve --port 4096
  tong_work env list

查看帮助:
  tong_work --help
  tong_work run --help
`;

const CLI_EXAMPLES = `
示例:

  # 启动 TUI（默认）
  tong_work

  # 直接运行任务
  tong_work run "帮我写一个 hello world"

  # 指定环境继续会话
  tong_work run "继续上次任务" --env prod --continue

  # 列出所有会话
  tong_work run --list-sessions

  # 安静模式（日志写到文件，stdout 只显示 AI 响应）
  tong_work run "任务" --quiet

  # 控制流式输出显示
  tong_work run "任务" --no-reasoning --no-tool-results

  # 启动服务器
  tong_work serve --port 4096

  # 环境管理
  tong_work env list
  tong_work env use dev
`;

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
  const memoryModule = await import("./commands/memory.js");
  const MemoryCommand = memoryModule.default || memoryModule.memoryCommand;
  const CompactionCommandModule = await import("./commands/compaction.js");
  const SessionCommandModule = await import("./commands/session.js");
  const CompactionCommand = CompactionCommandModule.default || CompactionCommandModule.CompactionCommand;

  await yargs(hideBin(process.argv))
    .scriptName("tong_work")
    .version(pkg.default.version)
    .usage(CLI_USAGE)
    .epilogue(CLI_EXAMPLES)
    .command(TuiCommand)
    .command(VersionCommand)
    .command(ServeCommand)
    .command(RunCommand)
    .command(AttachCommand)
    .command(EnvCommand)
    .command(MemoryCommand)
    .command(CompactionCommand)
    .command(SessionCommandModule.default || SessionCommandModule.SessionCommand)
    .demandCommand()
    .strict()
    .help()
    .alias("help", "h")
    .parse();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
