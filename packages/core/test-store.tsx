import { render } from "@opentui/solid";
import { createLogger } from "./src/utils/logger.js";
import { StoreProvider } from "./src/cli/tui/contexts/store.js";

const logger = createLogger("store-test", "store_test.log");

logger.info("Testing StoreProvider");

try {
  render(() => (
    <StoreProvider>
      <box>
        <text>With StoreProvider</text>
      </box>
    </StoreProvider>
  ));
  logger.info("StoreProvider test passed");
} catch (err) {
  logger.error("StoreProvider test failed", { error: err.message });
  console.error("Error:", err);
}

setTimeout(() => {
  logger.info("Test completed");
  process.exit(0);
}, 2000);
