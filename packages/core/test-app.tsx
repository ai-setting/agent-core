import { render } from "@opentui/solid";
import { createLogger } from "./src/utils/logger.js";
import { StoreProvider } from "./src/cli/tui/contexts/store.js";
import { ThemeProvider } from "./src/cli/tui/contexts/theme.js";
import { EventStreamProvider } from "./src/cli/tui/contexts/event-stream.js";
import { App } from "./src/cli/tui/components/App.js";

const logger = createLogger("app-test", "app_test.log");

logger.info("Testing App component");

try {
  render(() => (
    <StoreProvider>
      <ThemeProvider initialMode="dark">
        <EventStreamProvider initialUrl="http://localhost:3003">
          <App 
            sessionId="test-session"
            onExit={() => {
              logger.info("Exit called");
              process.exit(0);
            }}
          />
        </EventStreamProvider>
      </ThemeProvider>
    </StoreProvider>
  ));
  logger.info("App rendered successfully");
} catch (err) {
  logger.error("App test failed", { error: err.message, stack: err.stack });
  console.error("Error:", err);
}

setTimeout(() => {
  logger.info("Test timeout, exiting");
  process.exit(0);
}, 3000);
