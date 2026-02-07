#!/usr/bin/env bun
/**
 * @fileoverview Start script for Agent Core Server
 * 
 * Loads .env file and starts the server with LLM configuration.
 * 
 * Usage:
 *   ./start.ts              # Start with .env config
 *   ./start.ts --dev        # Start in dev mode (with hot reload)
 *   ./start.ts --port 3001  # Override port
 */

import { parseArgs } from "util";

// Parse command line arguments
const { values } = parseArgs({
  args: Bun.argv,
  options: {
    dev: { type: "boolean", default: false },
    port: { type: "string" },
  },
  strict: false,
  allowPositionals: true,
});

// Load .env file
async function loadEnvFile(path: string): Promise<void> {
  try {
    const file = Bun.file(path);
    if (!(await file.exists())) {
      console.warn(`⚠️  .env file not found: ${path}`);
      return;
    }

    const content = await file.text();
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) continue;
      
      // Parse KEY=VALUE
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();
        
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        if (key && value) {
          process.env[key] = value;
        }
      }
    }
    
    console.log(`✅ Loaded .env from ${path}`);
  } catch (error) {
    console.error(`❌ Failed to load .env: ${error}`);
  }
}

// Check required environment variables
function checkConfig(): boolean {
  const required = ["LLM_MODEL", "LLM_API_KEY"];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error("\n❌ Missing required environment variables:");
    missing.forEach(key => console.error(`   - ${key}`));
    console.error("\n📝 Please create a .env file with:");
    console.error("   LLM_MODEL=openai/gpt-4o-mini");
    console.error("   LLM_API_KEY=your-api-key");
    console.error("   LLM_BASE_URL=https://api.openai.com/v1  # optional");
    console.error("   PORT=3000  # optional");
    console.error("");
    return false;
  }
  
  return true;
}

// Print configuration
function printConfig(): void {
  console.log("\n📋 Configuration:");
  console.log(`   LLM_MODEL: ${process.env.LLM_MODEL}`);
  console.log(`   LLM_BASE_URL: ${process.env.LLM_BASE_URL || "(default)"}`);
  console.log(`   PORT: ${process.env.PORT || "3000"}`);
  console.log("");
}

// Main function
async function main() {
  console.log("🚀 Agent Core Server Starter");
  console.log("");

  // Load .env file
  await loadEnvFile(".env");
  
  // Override port if specified
  if (values.port && typeof values.port === "string") {
    process.env.PORT = values.port;
  }

  // Check configuration
  if (!checkConfig()) {
    process.exit(1);
  }

  // Print configuration
  printConfig();

  // Start server
  console.log("🔄 Starting server...\n");

  if (values.dev) {
    // Dev mode with hot reload
    const proc = Bun.spawn(["bun", "run", "--watch", "src/index.ts"], {
      stdio: ["inherit", "inherit", "inherit"],
      env: process.env,
    });
    await proc.exited;
  } else {
    // Production mode
    const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
      stdio: ["inherit", "inherit", "inherit"],
      env: process.env,
    });
    await proc.exited;
  }
}

main().catch(console.error);
