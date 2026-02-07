/**
 * @fileoverview SSE Client Test
 * 
 * Test script for SSE endpoint
 */

const EVENTS_URL = "http://localhost:3000/events";

console.log("Connecting to SSE endpoint...");
console.log(`URL: ${EVENTS_URL}`);
console.log();

const eventSource = new EventSource(EVENTS_URL);

let messageCount = 0;
const startTime = Date.now();

eventSource.onopen = () => {
  console.log("✅ Connected to server");
  console.log();
};

eventSource.onmessage = (event) => {
  try {
    const data = JSON.parse(event.data);
    messageCount++;
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    switch (data.type) {
      case "server.connected":
        console.log(`[${elapsed}s] 🔗 Server connected`);
        break;
        
      case "server.heartbeat":
        console.log(`[${elapsed}s] 💓 Heartbeat`);
        break;
        
      case "stream.start":
        console.log(`[${elapsed}s] 🚀 Stream started (model: ${data.properties?.model || "unknown"})`);
        break;
        
      case "stream.text":
        process.stdout.write(data.properties?.delta || "");
        break;
        
      case "stream.reasoning":
        console.log(`\n[${elapsed}s] 💭 Reasoning: ${data.properties?.content?.substring(0, 50)}...`);
        break;
        
      case "stream.tool.call":
        console.log(`\n[${elapsed}s] 🔧 Tool call: ${data.properties?.toolName}`);
        break;
        
      case "stream.completed":
        console.log(`\n[${elapsed}s] ✅ Stream completed`);
        break;
        
      case "stream.error":
        console.error(`\n[${elapsed}s] ❌ Error: ${data.properties?.error}`);
        break;
        
      default:
        console.log(`[${elapsed}s] 📨 ${data.type}:`, JSON.stringify(data.properties || data).substring(0, 100));
    }
  } catch (error) {
    console.error("Failed to parse event:", event.data);
  }
};

eventSource.onerror = (error) => {
  console.error("❌ SSE Error:", error);
};

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n👋 Closing connection...");
  eventSource.close();
  process.exit(0);
});

console.log("Waiting for events... (Press Ctrl+C to exit)");
console.log();
