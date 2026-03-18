/**
 * 测试 session 消息加载
 */

import { Session } from "./session.js";
import { Storage } from "./storage.js";

async function main() {
  // Initialize storage
  await Storage.initialize({ mode: "sqlite", path: "/home/dzk/.local/share/tong_work/agent-core/storage/sessions.db" });

  const sessionId = "test-compaction-real";
  
  // Get session via Session.get (like ServerEnvironment does)
  const session = Session.get(sessionId);
  
  if (!session) {
    console.log("Session not found via Session.get");
  } else {
    console.log("Session found:", session.id);
    console.log("Message count:", session.getMessages().length);
    
    // Try toHistory (like agent does)
    const history = await session.toHistory();
    console.log("History length:", history.length);
  }

  // Also try via Storage.getSession
  const storageSession = Storage.getSession(sessionId);
  if (!storageSession) {
    console.log("\nSession not found via Storage.getSession");
  } else {
    console.log("\nStorage session found:", storageSession.id);
    console.log("Message count:", storageSession.getMessages().length);
  }
}

main().catch(console.error);
