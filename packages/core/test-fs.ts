import { appendFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

const logFile = process.env.LOG_FILE || "test.log";
console.log("LOG_FILE:", logFile);
console.log("Dirname:", dirname(logFile));
console.log("Exists:", existsSync(dirname(logFile)));

try {
  const dir = dirname(logFile);
  if (dir !== "." && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log("Directory created");
  }
  appendFileSync(logFile, "Test message\n");
  console.log("File written successfully");
} catch (err) {
  console.error("Error:", err);
}
