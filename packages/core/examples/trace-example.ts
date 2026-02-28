import { SpanCollector, setSpanCollector, InMemorySpanStorage, wrapFunction } from "../src/utils/span-index";

async function main() {
  // Initialize collector with in-memory storage
  const storage = new InMemorySpanStorage();
  const collector = new SpanCollector(storage);
  await collector.initialize();
  setSpanCollector(collector);

  console.log("=== Example 1: Using wrapFunction ===\n");

  // Create traced functions
  const readFile = wrapFunction(
    async (path: string): Promise<string> => {
      await new Promise(r => setTimeout(r, 10));
      return `content of ${path}`;
    },
    "file.read",
    { recordParams: true }
  );

  const writeFile = wrapFunction(
    async (path: string, content: string): Promise<void> => {
      await new Promise(r => setTimeout(r, 5));
    },
    "file.write",
    { recordParams: true, recordResult: true }
  );

  // Start a parent span to keep trace context
  const opCtx = collector.startSpan("user.operation");
  const traceId1 = opCtx.traceId;

  // Single call
  await readFile("/tmp/test.txt");

  // Nested calls
  await writeFile("/tmp/out.txt", "hello");

  collector.endSpan(opCtx);

  console.log("Format Trace:");
  console.log(collector.formatTrace(traceId1));

  console.log("\n=== Example 2: Nested spans ===\n");

  // Start a new span context
  const agentCtx = collector.startSpan("agent.run");
  const traceId2 = agentCtx.traceId;

  // Simulate nested operations
  const readData = wrapFunction(
    async (path: string) => {
      // Inner operation
      const parse = wrapFunction(async (data: string) => {
        await new Promise(r => setTimeout(r, 2));
        return data.toUpperCase();
      }, "data.parse");
      
      const content = await readFile(path);
      return await parse(content);
    },
    "readData"
  );

  await readData("/tmp/data.txt");
  
  collector.endSpan(agentCtx);

  console.log("Format Trace (nested):");
  console.log(collector.formatTrace(traceId2));

  console.log("\n=== Example 3: With logging enabled ===\n");

  // Using wrapFunction with logging
  const fetchData = wrapFunction(
    async (query: string): Promise<any> => {
      await new Promise(r => setTimeout(r, 20));
      return { results: ["item1", "item2"], query };
    },
    "api.fetch",
    { log: true, recordParams: true, recordResult: true }
  );

  const searchWithTruncation = wrapFunction(
    async (data: string): Promise<string> => {
      return "x".repeat(1000); // Long result
    },
    "api.search",
    { log: true, maxLogSize: 50 }
  );

  const apiCtx = collector.startSpan("api.test");
  const traceId3 = apiCtx.traceId;
  
  await fetchData("test query");
  await searchWithTruncation("search data");
  collector.endSpan(apiCtx);

  console.log("Format Trace (with logging):");
  console.log(collector.formatTrace(traceId3));

  console.log("\n=== Example 4: List recent traces ===\n");
  console.log(collector.formatTraceTable());

  console.log("\n=== Example 5: Export trace as JSON ===\n");
  const json = collector.exportTrace(traceId3);
  console.log(json);

  console.log("\n=== Done ===");
}

main().catch(console.error);
