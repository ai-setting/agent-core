/**
 * 复现后台任务错误问题
 */

import { ServerEnvironment } from "../packages/core/src/server/environment.js";
import { getSpanCollector, InMemorySpanStorage, SpanCollector } from "../packages/core/src/utils/span-index.js";
import { getTraceContext } from "../packages/core/src/utils/trace-context.js";

async function main() {
  // 等待 ServerEnvironment 创建 SpanCollector
  process.env.EVENTSOURCE_POLLING_ENABLED = "false";

  console.log("==============================================");
  console.log("    后台任务错误复现测试 + Trace 验证");
  console.log("==============================================\n");

  const env = new ServerEnvironment({});
  await env.waitForReady();
  
  // 获取 ServerEnvironment 创建的 SpanCollector
  const collector = getSpanCollector();
  console.log("✓ SpanCollector 已初始化:", collector ? "是" : "否");
  
  const model = env.getCurrentModel();
  console.log("✓ ServerEnvironment 就绪");
  console.log(`  Model: ${model?.providerID}/${model?.modelID}\n`);

  // 创建父 Session
  const parentSession = env.createSession({ title: "Test Parent Session" });
  console.log("✓ 父 Session 已创建:", parentSession.id, "\n");

  // 模拟 server 中间件逻辑：初始化 trace context
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  getTraceContext().initContext(requestId, parentSession.id);
  console.log(`✓ Trace Context 初始化: requestId=${requestId}\n`);

  // 测试通过主 Agent 调用 task tool（后台任务）
  console.log("【测试后台任务】");
  console.log("Prompt: 启动后台任务帮我检索github trend最热门项目\n");
  
  await env.handle_query("启动后台任务帮我检索github trend最热门项目", {
    session_id: parentSession.id,
    onMessageAdded: (message) => {
      console.log(`[onMessageAdded] role=${message.role}, content=${JSON.stringify(message.content).substring(0, 150)}...`);
      parentSession.addMessageFromModelMessage(message);
    }
  });

  // 等待后台任务完成
  await new Promise(r => setTimeout(r, 5000));

  // 检查父 session 的消息
  console.log("\n【父 Session 消息列表】");
  const parentMessages = parentSession.toHistory();
  console.log(`共有 ${parentMessages.length} 条消息:`);
  for (let i = 0; i < parentMessages.length; i++) {
    const m = parentMessages[i];
    const content = typeof m.content === 'string' ? m.content.substring(0, 150) : JSON.stringify(m.content).substring(0, 150);
    console.log(`  [${i}] ${m.role}: ${content}...`);
  }

  // 检查 Trace
  console.log("\n【Trace 验证】");
  if (!collector) {
    console.log("⚠ SpanCollector 未初始化");
  } else {
    const traces = collector.listTraces(10);
    console.log(`共有 ${traces.length} 个 trace`);
    
    if (traces.length > 0) {
      for (const trace of traces) {
        console.log(`\nTrace ID: ${trace.traceId}`);
        console.log(`Span 数量: ${trace.spanCount}`);
        
        const spans = collector.getTrace(trace.traceId);
        console.log("Spans:");
        for (const span of spans) {
          console.log(`  - ${span.name} (${span.status})`);
          const params = (span.attributes as any).params;
          if (params) {
            console.log(`    params: ${JSON.stringify(params).substring(0, 100)}`);
          }
        }
      }
    } else {
      console.log("⚠ 没有 trace 数据，可能 trace 未启用");
    }
  }

  // 清理
  console.log("\n【清理资源】");
  const eventMcpManager = env.getEventMcpManager();
  if (eventMcpManager) {
    await eventMcpManager.disconnectAll();
  }
  
  console.log("\n测试完成!");
  process.exit(0);
}

main();
