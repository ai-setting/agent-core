#!/usr/bin/env bun
/**
 * @fileoverview tong_work CLI - Entry Point
 *
 * tong_work CLI - AI原生企业任务自主推进系统
 */

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { VersionCommand } from "./commands/version.js";
import { ServeCommand } from "./commands/serve.js";
import { RunCommand } from "./commands/run.js";
import { AttachCommand } from "./commands/attach.js";

async function main() {
  const pkg = await import("../package.json", { with: { type: "json" } });

  await yargs(hideBin(process.argv))
    .scriptName("tong_work")
    .version(pkg.default.version)
    .usage("$0 <command> [args]")
    .command(VersionCommand)
    .command(ServeCommand)
    .command(RunCommand)
    .command(AttachCommand)
    .demandCommand()
    .strict()
    .help()
    .parse();
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
