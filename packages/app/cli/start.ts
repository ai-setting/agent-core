#!/usr/bin/env bun
/**
 * @fileoverview Start script for Agent CLI Client
 * 
 * Connects to Agent Core Server via SSE for interactive chat.
 * 
 * Usage:
 *   ./start.ts                    # Connect to default server (localhost:3000)
 *   ./start.ts --server localhost:3001    # Custom server address
 *   ./start.ts --server http://remote.server.com:3000   # Remote server
 *   ./start.ts --session abc123   # Resume specific session
 */

import { parseArgs } from "util";
import { CLIEngine } from "./src/cli-engine.js";

// Parse command line arguments
const { values } = parseArgs({
  args: Bun.argv,
  options: {
    server: { type: "string" },
    session: { type: "string" },
  },
  strict: false,
  allowPositionals: true,
});

// Load .env file (optional)
async function loadEnvFile(path: string): Promise<void> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return;
    }

    const content = await file.text();
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();
        
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        if (key && value && !process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

// Parse server address
function parseServerAddress(input: string): string {
  // If already has protocol, use as-is
  if (input.startsWith("http://") || input.startsWith("https://")) {
    return input.replace(/\/$/, ""); // Remove trailing slash
  }
  
  // If contains port (e.g., "localhost:3001")
  if (input.includes(":")) {
    return `http://${input}`;
  }
  
  // Just hostname, add default port
  return `http://${input}:3000`;
}

// Main function
async function main() {
  console.log("🚀 Agent CLI Client Starter");
  console.log("");

  // Load .env file (optional)
  await loadEnvFile(".env");

  // Determine server URL
  let serverUrl: string;
  
  if (values.server && typeof values.server === "string") {
    // Use command line argument
    serverUrl = parseServerAddress(values.server);
  } else if (process.env.AGENT_SERVER_URL) {
    // Use environment variable
    serverUrl = process.env.AGENT_SERVER_URL.replace(/\/$/, "");
  } else {
    // Use default
    serverUrl = "http://localhost:3000";
  }

  // Validate URL
  try {
    new URL(serverUrl);
  } catch {
    console.error(`❌ Invalid server address: ${serverUrl}`);
    console.error("");
    console.error("Usage examples:");
    console.error("  ./start.ts");
    console.error("  ./start.ts --server localhost:3001");
    console.error("  ./start.ts --server http://192.168.1.100:3000");
    console.error("  ./start.ts --server https://remote.server.com");
    process.exit(1);
  }

  // Check server health before connecting
  console.log(`🔍 Checking server at ${serverUrl}...`);
  try {
    const response = await fetch(`${serverUrl}/health`, { 
      signal: AbortSignal.timeout(5000) 
    });
    
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    
    const data = await response.json();
    console.log(`✅ Server is running (version: ${data.version || "unknown"})`);
  } catch (error) {
    console.error(`❌ Cannot connect to server: ${error}`);
    console.error("");
    console.error("Please ensure:");
    console.error("1. Server is running: cd app/server && bun run start");
    console.error("2. Server address is correct");
    console.error("3. No firewall blocking the connection");
    console.error("");
    process.exit(1);
  }

  console.log("");

  // Get session ID
  const sessionId = values.session && typeof values.session === "string" 
    ? values.session 
    : undefined;

  if (sessionId) {
    console.log(`📁 Resuming session: ${sessionId}`);
  }

  console.log("");

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
