/**
 * @fileoverview Direct Runner
 *
 * 直接运行模式：自动启动服务器，然后附加
 */

interface DirectRunnerOptions {
  port: number;
  message: string;
  sessionID?: string;
  continueSession: boolean;
  model?: string;
}

export class DirectRunner {
  private options: DirectRunnerOptions;

  constructor(options: DirectRunnerOptions) {
    this.options = options;
  }

  async run() {
    console.log("=== tong_work 直接运行模式 ===");
    console.log("");

    if (this.options.message) {
      console.log(`执行任务: ${this.options.message}`);
    }

    if (this.options.continueSession || this.options.sessionID) {
      console.log("继续已有会话...");
    }

    console.log("");
    console.log("直接运行模式开发中...");
    console.log("请使用 'tong_work serve' 启动服务器，然后 'tong_work attach' 附加");
    console.log("");
    
    console.log(`提示: 使用以下命令启动:`);
    console.log(`  tong_work serve --port ${this.options.port}`);
    console.log(`  tong_work attach http://localhost:${this.options.port}`);
  }
}
