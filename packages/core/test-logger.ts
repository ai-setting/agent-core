import { createLogger } from "./src/utils/logger.js";

const logger = createLogger("test");

logger.info("Test info message");
logger.debug("Test debug message", { key: "value" });
logger.error("Test error message");

console.log("Logger test completed");
