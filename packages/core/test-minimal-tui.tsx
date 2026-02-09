import { render } from "@opentui/solid";
import { createLogger } from "./src/utils/logger.js";

const logger = createLogger("minimal-test", "minimal_test.log");

logger.info("Starting minimal TUI test");

try {
  render(() => (
    <box>
      <text>Hello from TUI!</text>
    </box>
  ));
  logger.info("TUI rendered successfully");
} catch (err) {
  logger.error("TUI render failed", { error: err.message });
  console.error("Error:", err);
}

// Keep running
setTimeout(() => {
  logger.info("Test completed");
  process.exit(0);
}, 3000);
