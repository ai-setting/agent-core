/**
 * @fileoverview TUI Command 测试脚本
 * 
 * 通过程序化方式测试 Command Palette 功能
 * 使用方法: bun run test:tui-command
 */

import { render } from "@opentui/solid";
import { App } from "../components/index.js";
import { StoreProvider, ThemeProvider, MarkdownStyleProvider, EventStreamProvider, CommandProvider } from "../contexts/index.js";

const TEST_SERVER_URL = process.env.TEST_SERVER_URL || "http://localhost:3003";

console.log("=== TUI Command 功能测试 ===\n");

// 测试配置
const testConfig = {
  url: TEST_SERVER_URL,
  timeout: 10000, // 10秒超时
};

// 模拟测试场景
async function runTests() {
  console.log(`[测试] 连接服务器: ${testConfig.url}`);
  
  // 1. 测试服务器连接
  try {
    const response = await fetch(`${testConfig.url}/commands`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const commands = await response.json() as Array<{ name: string; description: string }>;
    console.log(`[✓] 服务器连接成功，发现 ${commands.length} 个命令`);
    commands.forEach((cmd) => {
      console.log(`    - /${cmd.name}: ${cmd.description}`);
    });
  } catch (error) {
    console.error(`[✗] 服务器连接失败: ${error}`);
    console.log("\n请确保服务器正在运行:");
    console.log("  bun run start");
    process.exit(1);
  }

  // 2. 测试命令执行
  console.log("\n[测试] 执行 echo 命令...");
  try {
    const response = await fetch(`${testConfig.url}/commands/echo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ args: "test from tui script" }),
    });
    const result = await response.json() as { success: boolean; message: string };
    if (result.success) {
      console.log(`[✓] 命令执行成功: ${result.message}`);
    } else {
      console.error(`[✗] 命令执行失败: ${result.message}`);
    }
  } catch (error) {
    console.error(`[✗] 命令执行出错: ${error}`);
  }

  // 3. 启动 TUI 进行交互式测试
  console.log("\n[测试] 启动 TUI 交互式测试...");
  console.log("请手动执行以下操作:\n");
  console.log("1. 在 TUI 输入框中输入 '/' (斜杠)");
  console.log("2. 观察是否在输入框上方显示命令列表");
  console.log("3. 输入 '/echo hello' 并回车");
  console.log("4. 检查是否显示执行结果\n");
  console.log("按 Ctrl+C 退出测试\n");

  // 渲染 TUI
  render(() => (
    <StoreProvider>
      <ThemeProvider initialMode="dark">
        <MarkdownStyleProvider>
          <EventStreamProvider initialUrl={testConfig.url}>
            <CommandProvider serverUrl={testConfig.url}>
              <App />
            </CommandProvider>
          </EventStreamProvider>
        </MarkdownStyleProvider>
      </ThemeProvider>
    </StoreProvider>
  ));

  // 处理退出
  process.on("SIGINT", () => {
    console.log("\n\n[测试] 测试完成");
    process.exit(0);
  });
}

// 运行测试
runTests().catch(console.error);
