#!/usr/bin/env bun
/**
 * @fileoverview Agent CLI - Entry Point
 * 
 * Command-line interface for agent-core.
 * 
 * Usage:
 *   agent-cli                    # Interactive mode
 *   agent-cli --server <url>     # Connect to specific server
 *   agent-cli --session <id>     # Resume specific session
 */

import { CLIEngine } from "./cli-engine.js";

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  let serverUrl = "http://localhost:3000";
  let sessionId: string | undefined;

  // Simple argument parsing
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg === "--server" && nextArg) {
      serverUrl = nextArg;
      i++;
    } else if (arg === "--session" && nextArg) {
      sessionId = nextArg;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Agent CLI");
      console.log("");
      console.log("Usage: agent-cli [options]");
      console.log("");
      console.log("Options:");
      console.log("  --server <url>     Server URL (default: http://localhost:3000)");
      console.log("  --session <id>     Session ID to resume");
      console.log("  --help, -h         Show help");
      console.log("");
      console.log("Commands (interactive mode):");
      console.log("  <query>    Send message to AI");
      console.log("  clear      Clear screen");
      console.log("  exit       Exit program");
      console.log("  help       Show help");
      process.exit(0);
    }
  }

  // Check environment variable
  if (process.env.AGENT_SERVER_URL) {
    serverUrl = process.env.AGENT_SERVER_URL;
  }

  // Create and run CLI
  const cli = new CLIEngine({
    serverUrl,
    sessionId,
  });

  try {
    await cli.run();
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
