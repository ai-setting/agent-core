import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("Logger", () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = join(tmpdir(), `logger-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    originalEnv = process.env.LOG_LEVEL;
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    if (originalEnv === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalEnv;
    }
  });

  test("debug logs should NOT be written when level is info (default)", async () => {
    delete process.env.LOG_LEVEL;
    
    const { Logger } = await import("./logger.js");
    const logFile = join(tempDir, "test-info.log");
    
    const logger = new Logger({ level: "info", filename: "test-info.log" });
    (logger as any).logFile = logFile;
    
    logger.debug("This is a debug message");
    logger.info("This is an info message");
    
    const content = existsSync(logFile) ? readFileSync(logFile, "utf-8") : "";
    
    expect(content).not.toContain("This is a debug message");
    expect(content).toContain("This is an info message");
  });

  test("debug logs should be written when level is debug", async () => {
    const { Logger } = await import("./logger.js");
    const logFile = join(tempDir, "test-debug.log");
    
    const logger = new Logger({ level: "debug", filename: "test-debug.log" });
    (logger as any).logFile = logFile;
    
    logger.debug("This is a debug message");
    logger.info("This is an info message");
    
    const content = readFileSync(logFile, "utf-8");
    
    expect(content).toContain("This is a debug message");
    expect(content).toContain("This is an info message");
  });

  test("debug logs with data should be written correctly", async () => {
    const { Logger } = await import("./logger.js");
    const logFile = join(tempDir, "test-debug-data.log");
    
    const logger = new Logger({ level: "debug", filename: "test-debug-data.log" });
    (logger as any).logFile = logFile;
    
    logger.debug("Debug with data", { key: "value", count: 42 });
    
    const content = readFileSync(logFile, "utf-8");
    
    expect(content).toContain("Debug with data");
    expect(content).toContain('"key": "value"');
    expect(content).toContain('"count": 42');
  });

  test("LOG_LEVEL=debug env variable should enable debug logs", async () => {
    process.env.LOG_LEVEL = "debug";
    
    const { Logger } = await import("./logger.js");
    const logFile = join(tempDir, "test-env-debug.log");
    
    const logger = new Logger({ filename: "test-env-debug.log" });
    (logger as any).logFile = logFile;
    
    logger.debug("Debug from env");
    
    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("Debug from env");
  });

  test("all log levels should be written when level is debug", async () => {
    const { Logger } = await import("./logger.js");
    const logFile = join(tempDir, "test-all-levels.log");
    
    const logger = new Logger({ level: "debug", filename: "test-all-levels.log" });
    (logger as any).logFile = logFile;
    
    logger.debug("Debug message");
    logger.info("Info message");
    logger.warn("Warn message");
    logger.error("Error message");
    
    const content = readFileSync(logFile, "utf-8");
    
    expect(content).toContain("[DEBUG]");
    expect(content).toContain("[INFO]");
    expect(content).toContain("[WARN]");
    expect(content).toContain("[ERROR]");
  });

  test("only error logs when level is error", async () => {
    const { Logger } = await import("./logger.js");
    const logFile = join(tempDir, "test-error-only.log");
    
    const logger = new Logger({ level: "error", filename: "test-error-only.log" });
    (logger as any).logFile = logFile;
    
    logger.debug("Debug message");
    logger.info("Info message");
    logger.warn("Warn message");
    logger.error("Error message");
    
    const content = existsSync(logFile) ? readFileSync(logFile, "utf-8") : "";
    
    expect(content).not.toContain("Debug message");
    expect(content).not.toContain("Info message");
    expect(content).not.toContain("Warn message");
    expect(content).toContain("Error message");
  });

  test("createLogger should create logger with prefix", async () => {
    const { createLogger, Logger } = await import("./logger.js");
    const logFile = join(tempDir, "test-prefix.log");
    
    const logger = createLogger("test:module", "test-prefix.log");
    (logger as any).logFile = logFile;
    
    logger.info("Test message");
    
    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("[test:module]");
  });
});
