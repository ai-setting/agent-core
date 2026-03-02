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

  test("log location should show module path format (module/file.ts:line)", async () => {
    const { Logger } = await import("./logger.js");
    const logFile = join(tempDir, "test-location.log");
    
    const logger = new Logger({ level: "debug", filename: "test-location.log" });
    (logger as any).logFile = logFile;
    
    logger.info("Test message");
    
    const content = readFileSync(logFile, "utf-8");
    const locationMatch = content.match(/\[(.*?\.ts:\d+)\]/);
    expect(locationMatch).not.toBeNull();
    expect(locationMatch![1]).toContain("logger.test.ts");
  });

  test("LOG_DIR env var should override default log directory", async () => {
    const originalLogDir = process.env.LOG_DIR;
    const customLogDir = join(tempDir, "custom-logs");
    
    process.env.LOG_DIR = customLogDir;
    
    const { getLogDir, DEFAULT_LOG_DIR, Logger } = await import("./logger.js");
    
    expect(getLogDir()).toBe(customLogDir);
    expect(getLogDir()).not.toBe(DEFAULT_LOG_DIR);
    
    const logger = new Logger({ level: "debug", filename: "env-override.log" });
    expect(logger.getLogFile()).toBe(join(customLogDir, "env-override.log"));
    
    if (originalLogDir === undefined) {
      delete process.env.LOG_DIR;
    } else {
      process.env.LOG_DIR = originalLogDir;
    }
  });

  test("setLogDirOverride should override log directory", async () => {
    const { setLogDirOverride, getLogDir, DEFAULT_LOG_DIR, Logger } = await import("./logger.js");
    
    const overridePath = join(tempDir, "override-logs");
    setLogDirOverride(overridePath);
    
    expect(getLogDir()).toBe(overridePath);
    expect(getLogDir()).not.toBe(DEFAULT_LOG_DIR);
    
    const logger = new Logger({ level: "debug", filename: "override.log" });
    expect(logger.getLogFile()).toBe(join(overridePath, "override.log"));
    
    setLogDirOverride(null as any);
  });

  test("LOG_DIR env var should have higher priority than setLogDirOverride", async () => {
    const originalLogDir = process.env.LOG_DIR;
    const { setLogDirOverride, getLogDir, Logger } = await import("./logger.js");
    
    const overridePath = join(tempDir, "override");
    setLogDirOverride(overridePath);
    
    const envPath = join(tempDir, "env-path");
    process.env.LOG_DIR = envPath;
    
    expect(getLogDir()).toBe(envPath);
    
    const logger = new Logger({ level: "debug", filename: "priority-test.log" });
    expect(logger.getLogFile()).toBe(join(envPath, "priority-test.log"));
    
    setLogDirOverride(null as any);
    if (originalLogDir === undefined) {
      delete process.env.LOG_DIR;
    } else {
      process.env.LOG_DIR = originalLogDir;
    }
  });

  test("DEFAULT_LOG_DIR should be XDG compatible default path", async () => {
    const { DEFAULT_LOG_DIR } = await import("./logger.js");
    
    expect(DEFAULT_LOG_DIR).toContain("tong_work");
    expect(DEFAULT_LOG_DIR).toContain("logs");
  });
});
