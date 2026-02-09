/**
 * @fileoverview TUI Event Test - 测试事件接收
 */

import { createLogger } from "./src/utils/logger.js";

const logger = createLogger("tui-test", "tui_test.log");

async function testEventStream() {
  logger.info("=== TUI Event Test Starting ===");
  
  const url = "http://localhost:3003";
  
  // 1. 创建会话
  logger.info("Creating session...");
  const sessionRes = await fetch(`${url}/sessions`, { method: "POST" });
  const session = await sessionRes.json();
  logger.info("Session created", { sessionId: session.id });
  
  // 2. 连接 SSE
  logger.info("Connecting to SSE...");
  const response = await fetch(`${url}/events?session=${encodeURIComponent(session.id)}`);
  
  if (!response.ok) {
    logger.error("Failed to connect", { status: response.status });
    return;
  }
  
  logger.info("Connected to SSE");
  
  // 3. 读取事件
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventCount = 0;
  
  // 4. 发送 prompt
  setTimeout(async () => {
    logger.info("Sending prompt...");
    await fetch(`${url}/sessions/${session.id}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hi" }),
    });
    logger.info("Prompt sent");
  }, 1000);
  
  // 5. 接收事件
  while (eventCount < 10) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        
        try {
          const event = JSON.parse(data);
          eventCount++;
          logger.info("Received event", { 
            type: event.type, 
            count: eventCount,
            messageId: event.messageId 
          });
          
          if (event.type === "stream.completed") {
            logger.info("Stream completed, exiting");
            return;
          }
        } catch (e) {
          logger.warn("Parse error", { data: data.slice(0, 50) });
        }
      }
    }
  }
  
  logger.info("Test finished", { totalEvents: eventCount });
}

testEventStream().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
