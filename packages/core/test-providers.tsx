import { render } from "@opentui/solid";
import { createLogger } from "./src/utils/logger.js";
import { StoreProvider } from "./src/cli/tui/contexts/store.js";
import { ThemeProvider } from "./src/cli/tui/contexts/theme.js";
import { EventStreamProvider } from "./src/cli/tui/contexts/event-stream.js";

const logger = createLogger("providers-test", "providers_test.log");

logger.info("Testing all Providers");

try {
  render(() => (
    <StoreProvider>
      <ThemeProvider initialMode="dark">
        <EventStreamProvider initialUrl="http://localhost:3003">
          <box>
            <text>All Providers Working!</text>
          </box>
        </EventStreamProvider>
      </ThemeProvider>
    </StoreProvider>
  ));
  logger.info("All Providers test passed");
} catch (err) {
  logger.error("Providers test failed", { error: err.message, stack: err.stack });
  console.error("Error:", err);
}

setTimeout(() => {
  logger.info("Test completed");
  process.exit(0);
}, 2000);
