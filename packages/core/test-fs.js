import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const logDir = join(homedir(), ".config", "tong_work", "logs");
const logFile = join(logDir, "test.log");

console.log("HOME:", homedir());
console.log("LogDir:", logDir);
console.log("LogFile:", logFile);
console.log("LogDir exists:", existsSync(logDir));

try {
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
    console.log("Directory created");
  }
  
  appendFileSync(logFile, "Test entry at " + new Date().toISOString() + "\n");
  console.log("File written successfully");
  console.log("File exists:", existsSync(logFile));
} catch (err) {
  console.error("Error:", err);
}
