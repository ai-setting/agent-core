/**
 * 准备测试数据：创建有大量消息的 session 来触发压缩
 * 运行: bun run src/core/session/prepare-test-session.ts
 */

import { Session } from "./session.js";
import { Storage } from "./storage.js";

async function main() {
  // Initialize with file storage to persist
  await Storage.initialize({ mode: "sqlite", path: "/home/dzk/.local/share/tong_work/agent-core/storage/sessions.db" });

  const sessionId = "test-compaction-session";

  // Check if session already exists
  let session = Session.get(sessionId);
  
  if (session) {
    console.log("Deleting existing session:", sessionId);
    Storage.deleteSession(sessionId);
  }

  console.log("Creating new session:", sessionId);
  session = new Session({
    id: sessionId,
    title: "Test Compaction Session",
  });

  // Add LOTS of messages to trigger compaction
  // The threshold is 80%, so we need a lot of content
  const longContent = `
TypeScript 是 JavaScript 的超集，它为 JavaScript 添加了类型系统和其他特性。以下是 TypeScript 的主要特性：

1. **类型系统**：TypeScript 添加了静态类型支持，可以在编译时检查类型错误。这有助于在开发过程中捕获错误，而不是在运行时。

2. **接口**：接口用于定义对象的形状，可以用于类型检查。

3. **泛型**：泛型允许创建可复用的组件，能够支持多种类型。

4. **枚举**：枚举用于定义命名常量集合。

5. **模块系统**：TypeScript 支持 ES6 模块语法。

6. **装饰器**：装饰器是一种特殊类型的声明，可以附加到类声明、方法、访问符、属性或参数上。

学习 TypeScript 的步骤：
1. 首先学习 JavaScript 基础
2. 了解 TypeScript 的类型系统
3. 学习接口和类型别名
4. 掌握泛型编程
5. 学习高级类型特性
6. 实践项目开发

推荐的学习资源：
- TypeScript 官方文档
- TypeScript Deep Dive
- 《Programming TypeScript》
- Udemy 在线课程

常用工具：
- TypeScript 编译器 (tsc)
- ts-node：运行 TypeScript 代码
- ESLint：代码检查
- Prettier：代码格式化

实际项目示例：
\`\`\`typescript
interface User {
  id: number;
  name: string;
  email: string;
}

interface ApiResponse<T> {
  data: T;
  status: number;
  message: string;
}

class UserService {
  async getUser(id: number): Promise<ApiResponse<User>> {
    const response = await fetch(\`/api/users/\${id}\`);
    return response.json();
  }
}
\`\`\`

错误处理最佳实践：
1. 使用 Result 类型
2. 自定义 Error 类
3. 全局错误处理中间件

总结：TypeScript 是一个强大的工具，可以帮助开发者构建更可靠的应用程序。通过使用类型系统，我们可以在编译时捕获错误，提高代码质量。
`.repeat(3); // Make it even longer

  // Add 50 pairs of messages (100 messages total)
  for (let i = 0; i < 50; i++) {
    session.addUserMessage(`问题 ${i + 1}: ${longContent.substring(0, 500)}`);
    session.addAssistantMessage(`回答 ${i + 1}: ${longContent.substring(0, 800)}`);
  }

  console.log(`\n✅ Session prepared: ${sessionId}`);
  console.log(`   Messages: ${session.getMessages().length}`);
  console.log(`\nNow run: tong_work run -s ${sessionId} "请总结一下今天学习的内容"`);
}

main().catch(console.error);
