/**
 * @fileoverview TUI - Terminal User Interface
 *
 * 简单的终端用户界面
 */

interface TUIOptions {
  url: string;
  directory?: string;
  sessionID?: string;
  password?: string;
}

export async function attachTUI(options: TUIOptions) {
  const readline = await import("readline");
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`连接到服务器: ${options.url}`);
  console.log(`工作目录: ${options.directory || process.cwd()}`);
  
  if (options.sessionID) {
    console.log(`会话 ID: ${options.sessionID}`);
  }

  console.log("");
  console.log("=== tong_work CLI ===");
  console.log("输入消息与 AI 对话，输入 'exit' 退出");
  console.log("");

  // 简单消息输入循环
  const ask = () => {
    rl.question("> ", async (input) => {
      if (input.trim().toLowerCase() === "exit") {
        console.log("再见！");
        rl.close();
        process.exit(0);
      }

      if (input.trim()) {
        console.log(`发送消息: ${input}`);
        // TODO: 实现实际的消息发送逻辑
        console.log("AI: (功能开发中...)");
      }

      ask();
    });
  };

  ask();
}
