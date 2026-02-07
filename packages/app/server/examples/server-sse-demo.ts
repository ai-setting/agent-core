/**
 * @fileoverview Server + SSE Demo
 * 
 * Demonstrates full flow: ServerEnvironment → EventBus → SSE → Client
 */

import { ServerEnvironment } from "../src/environment.js";
import { AgentServer } from "../src/server.js";

async function main() {
  // Load config
  const port = parseInt(process.env.PORT || "3000");
  const model = process.env.LLM_MODEL;
  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL;

  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     Agent Core Server + SSE Demo                           ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log();

  // Create ServerEnvironment if LLM configured
  let env: ServerEnvironment | undefined;
  if (model && apiKey) {
    console.log("🔄 初始化 ServerEnvironment...");
    env = new ServerEnvironment({
      model,
      apiKey,
      baseURL,
    });
    console.log(`✅ Environment 已创建 (Model: ${model})`);
    console.log(`   Tools: ${env.listTools().map(t => t.name).join(", ")}`);
    console.log();
  } else {
    console.log("⚠️  LLM 未配置，Server 将以简化模式运行");
    console.log("   设置 LLM_MODEL 和 LLM_API_KEY 启用完整功能");
    console.log();
  }

  // Start HTTP Server
  const server = new AgentServer({
    port,
    hostname: "0.0.0.0",
  });

  await server.start();
  console.log();

  // If LLM configured, run an example query
  if (env) {
    console.log("📝 发送示例查询...");
    console.log("   你可以通过以下方式查看流式输出:");
    console.log(`   curl -N http://localhost:${port}/events`);
    console.log();
    console.log("   或者使用浏览器访问:");
    console.log(`   http://localhost:${port}/events`);
    console.log();
    
    // Import Session
    const { Session } = await import("../../../src/index.js");
    const session = Session.create({ 
      title: "SSE Demo", 
      directory: process.cwd() 
    });
    
    console.log(`   Session ID: ${session.id}`);
    console.log(`   使用 sessionId 过滤: /events?sessionId=${session.id}`);
    console.log();
    
    // Send a test query after a short delay
    setTimeout(async () => {
      const query = "你好，请简单介绍一下自己";
      console.log(`💬 发送查询: "${query}"`);
      console.log("   观察 SSE 流式输出...");
      console.log();
      
      try {
        const history = session.toHistory();
        await env.handle_query(query, { session_id: session.id }, history);
      } catch (error) {
        console.error("Query failed:", error);
      }
    }, 3000);
  }

  console.log("按 Ctrl+C 停止服务");
}

main().catch(console.error);
