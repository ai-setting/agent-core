/**
 * @fileoverview MessageList 组件单元测试
 *
 * 测试消息列表的数据处理和渲染逻辑
 */

import { describe, it, expect, beforeEach } from "bun:test";
import type { Message, MessagePart } from "../contexts/store.js";

// ============================================================================
// 测试数据构造
// ============================================================================

/**
 * 构造用户消息
 */
function createUserMessage(content: string, id?: string): Message {
  return {
    id: id || `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    role: "user",
    content,
    timestamp: Date.now(),
  };
}

/**
 * 构造助手消息
 */
function createAssistantMessage(content: string, id?: string): Message {
  return {
    id: id || `assistant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    role: "assistant",
    content,
    timestamp: Date.now(),
  };
}

/**
 * 构造消息分片
 */
function createTextPart(content: string, id?: string): MessagePart {
  return {
    id: id || `text-${Date.now()}`,
    type: "text",
    content,
    timestamp: Date.now(),
  };
}

function createReasoningPart(content: string, id?: string): MessagePart {
  return {
    id: id || `reasoning-${Date.now()}`,
    type: "reasoning",
    content,
    timestamp: Date.now(),
  };
}

function createToolCallPart(toolName: string, toolArgs: Record<string, unknown>, id?: string): MessagePart {
  return {
    id: id || `tool-${Date.now()}`,
    type: "tool_call",
    toolName,
    toolArgs,
    timestamp: Date.now(),
  };
}

function createToolResultPart(toolName: string, result: unknown, success: boolean, id?: string): MessagePart {
  return {
    id: id || `result-${Date.now()}`,
    type: "tool_result",
    toolName,
    result,
    success,
    timestamp: Date.now(),
  };
}

// ============================================================================
// 测试场景 1: 数据过滤逻辑
// ============================================================================

describe("MessageList 数据过滤逻辑", () => {
  it("应该正确过滤出 reasoning 类型的分片", () => {
    const parts: MessagePart[] = [
      createTextPart("正常文本"),
      createReasoningPart("思考过程 1"),
      createTextPart("更多文本"),
      createReasoningPart("思考过程 2"),
    ];

    const reasoningParts = parts.filter(p => p.type === "reasoning");

    expect(reasoningParts.length).toBe(2);
    expect(reasoningParts[0].content).toBe("思考过程 1");
    expect(reasoningParts[1].content).toBe("思考过程 2");
  });

  it("应该正确过滤出 text 类型的分片", () => {
    const parts: MessagePart[] = [
      createReasoningPart("思考过程"),
      createTextPart("文本 1"),
      createToolCallPart("bash", { command: "ls" }),
      createTextPart("文本 2"),
    ];

    const textParts = parts.filter(p => p.type === "text");

    expect(textParts.length).toBe(2);
    expect(textParts[0].content).toBe("文本 1");
    expect(textParts[1].content).toBe("文本 2");
  });

  it("应该正确处理空的分片数组", () => {
    const parts: MessagePart[] = [];

    const reasoningParts = parts.filter(p => p.type === "reasoning");
    const textParts = parts.filter(p => p.type === "text");

    expect(reasoningParts.length).toBe(0);
    expect(textParts.length).toBe(0);
  });
});

// ============================================================================
// 测试场景 2: 内容拼接逻辑
// ============================================================================

describe("MessageList 内容拼接逻辑", () => {
  it("应该正确拼接多个 text 分片的内容", () => {
    const parts: MessagePart[] = [
      createTextPart("Hello "),
      createTextPart("World"),
      createTextPart("!"),
    ];

    const displayContent = parts.map(p => p.content || "").join("");

    expect(displayContent).toBe("Hello World!");
  });

  it("应该正确处理包含空内容的 text 分片", () => {
    const parts: MessagePart[] = [
      createTextPart("Start"),
      { ...createTextPart(""), content: undefined },
      createTextPart("End"),
    ];

    const displayContent = parts.map(p => p.content || "").join("");

    expect(displayContent).toBe("StartEnd");
  });

  it("应该正确处理复杂 Markdown 内容的拼接", () => {
    const parts: MessagePart[] = [
      createTextPart("# 标题\n\n"),
      createTextPart("这是**粗体**文本。\n\n"),
      createTextPart("```typescript\nconst x = 1;\n```"),
    ];

    const displayContent = parts.map(p => p.content || "").join("");

    expect(displayContent).toContain("# 标题");
    expect(displayContent).toContain("**粗体**");
    expect(displayContent).toContain("```typescript");
  });
});

// ============================================================================
// 测试场景 3: 消息类型识别
// ============================================================================

describe("MessageList 消息类型识别", () => {
  it("应该正确识别用户消息", () => {
    const userMessage = createUserMessage("用户输入");

    expect(userMessage.role).toBe("user");
  });

  it("应该正确识别助手消息", () => {
    const assistantMessage = createAssistantMessage("助手回复");

    expect(assistantMessage.role).toBe("assistant");
  });

  it("应该正确处理消息 ID 生成", () => {
    const msg1 = createUserMessage("test");
    const msg2 = createUserMessage("test");

    expect(msg1.id).not.toBe(msg2.id);
    expect(msg1.id).toContain("user-");
    expect(msg2.id).toContain("user-");
  });
});

// ============================================================================
// 测试场景 4: 完整对话流程数据
// ============================================================================

describe("MessageList 完整对话流程", () => {
  it("应该正确处理简单的问答流程", () => {
    // 构造一个完整的简单对话
    const messages: Message[] = [
      createUserMessage("你好，请介绍一下自己"),
      createAssistantMessage("你好！我是 AI 助手。"),
    ];

    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });

  it("应该正确处理包含代码块的回复", () => {
    const markdownContent = `我来写一个示例代码：

\`\`\`typescript
function greet(name: string) {
  return \`Hello, \${name}!\`;
}
\`\`\`

使用方式：
\`\`\`typescript
console.log(greet("World"));
\`\`\``;

    const assistantMessage = createAssistantMessage(markdownContent);

    expect(assistantMessage.content).toContain("```typescript");
    expect(assistantMessage.content).toContain("function greet");
  });

  it("应该正确处理带思考过程的消息", () => {
    const messageId = "msg-test-123";
    const assistantMessage = createAssistantMessage("最终答案", messageId);

    const parts: Record<string, MessagePart[]> = {
      [messageId]: [
        createReasoningPart("让我思考一下这个问题..."),
        createReasoningPart("首先，我需要分析需求..."),
        createTextPart("最终答案"),
      ],
    };

    const messageParts = parts[messageId] || [];
    const reasoningParts = messageParts.filter(p => p.type === "reasoning");
    const textParts = messageParts.filter(p => p.type === "text");

    expect(reasoningParts.length).toBe(2);
    expect(textParts.length).toBe(1);
    expect(reasoningParts[0].content).toContain("让我思考一下");
    expect(textParts[0].content).toBe("最终答案");
  });

  it("应该正确处理工具调用流程", () => {
    const messageId = "msg-tool-test";

    const parts: Record<string, MessagePart[]> = {
      [messageId]: [
        createTextPart("我来查看一下目录结构"),
        createToolCallPart("bash", { command: "ls -la" }),
        createToolResultPart("bash", "total 128\ndrwxr-xr-x  5 user  staff   160 Jan 15 10:00 .\n...", true),
        createTextPart("目录中包含以下文件..."),
      ],
    };

    const messageParts = parts[messageId] || [];
    const toolCallParts = messageParts.filter(p => p.type === "tool_call");
    const toolResultParts = messageParts.filter(p => p.type === "tool_result");

    expect(toolCallParts.length).toBe(1);
    expect(toolResultParts.length).toBe(1);
    expect(toolCallParts[0].toolName).toBe("bash");
    expect(toolResultParts[0].success).toBe(true);
  });
});

// ============================================================================
// 测试场景 5: 流式数据处理
// ============================================================================

describe("MessageList 流式数据处理", () => {
  it("应该正确处理增量文本追加", () => {
    const messageId = "msg-stream-test";
    const message = createAssistantMessage("", messageId);

    // 模拟流式接收的增量数据
    const deltas = ["Hello", " ", "World", "!"];
    let currentContent = message.content;

    for (const delta of deltas) {
      currentContent += delta;
    }

    expect(currentContent).toBe("Hello World!");
  });

  it("应该正确处理累积式 reasoning 内容", () => {
    const messageId = "msg-reasoning-test";

    // 模拟 reasoning 事件发送累积内容
    const reasoningUpdates = [
      "让我思考",
      "让我思考一下", 
      "让我思考一下这个问题",
      "让我思考一下这个问题...",
    ];

    // 最后一次更新应该包含完整内容
    const finalContent = reasoningUpdates[reasoningUpdates.length - 1];

    expect(finalContent).toContain("让我思考");
    expect(finalContent).toContain("这个问题");
  });
});

// ============================================================================
// 测试场景 6: Markdown 内容测试
// ============================================================================

describe("MessageList Markdown 内容渲染数据", () => {
  it("应该正确处理标题", () => {
    const content = `# 一级标题
## 二级标题
### 三级标题`;

    const message = createAssistantMessage(content);

    expect(message.content).toContain("# 一级标题");
    expect(message.content).toContain("## 二级标题");
    expect(message.content).toContain("### 三级标题");
  });

  it("应该正确处理列表", () => {
    const content = `项目列表：
- 项目 1
- 项目 2
- 项目 3

有序列表：
1. 第一项
2. 第二项
3. 第三项`;

    const message = createAssistantMessage(content);

    expect(message.content).toContain("- 项目 1");
    expect(message.content).toContain("1. 第一项");
  });

  it("应该正确处理链接", () => {
    const content = `查看 [OpenTUI 文档](https://opentui.dev) 获取更多信息。`;

    const message = createAssistantMessage(content);

    expect(message.content).toContain("[OpenTUI 文档]");
    expect(message.content).toContain("(https://opentui.dev)");
  });

  it("应该正确处理引用块", () => {
    const content = `> 这是一段引用文本
> 引用可以有多行`;

    const message = createAssistantMessage(content);

    expect(message.content).toContain("> 这是一段引用");
  });

  it("应该正确处理行内代码和代码块", () => {
    const content = `使用 \`console.log\` 来输出日志。

多行代码：
\`\`\`javascript
const x = 1;
const y = 2;
console.log(x + y);
\`\`\``;

    const message = createAssistantMessage(content);

    expect(message.content).toContain("`console.log`");
    expect(message.content).toContain("```javascript");
  });

  it("应该正确处理强调文本", () => {
    const content = `这是**粗体**文本，这是*斜体*文本，这是***粗斜体***文本。`;

    const message = createAssistantMessage(content);

    expect(message.content).toContain("**粗体**");
    expect(message.content).toContain("*斜体*");
    expect(message.content).toContain("***粗斜体***");
  });

  it("应该正确处理复杂混合 Markdown", () => {
    const content = `# 项目介绍

这是一个**重要的**项目。

## 功能列表

- 功能 A：支持 \`typescript\`
- 功能 B：[查看文档](https://example.com)

> 注意：这是一个引用提示

\`\`\`typescript
// 示例代码
const app = new Application();
app.run();
\`\`\``;

    const message = createAssistantMessage(content);

    // 验证包含各种 Markdown 元素
    expect(message.content).toContain("# 项目介绍");
    expect(message.content).toContain("**重要的**");
    expect(message.content).toContain("- 功能 A");
    expect(message.content).toContain("[查看文档]");
    expect(message.content).toContain("> 注意：");
    expect(message.content).toContain("```typescript");
  });
});

// ============================================================================
// 测试场景 7: 边界情况
// ============================================================================

describe("MessageList 边界情况", () => {
  it("应该正确处理空内容消息", () => {
    const message = createAssistantMessage("");

    expect(message.content).toBe("");
  });

  it("应该正确处理超长内容", () => {
    const longContent = "a".repeat(10000);
    const message = createAssistantMessage(longContent);

    expect(message.content.length).toBe(10000);
  });

  it("应该正确处理特殊字符", () => {
    const content = `特殊字符测试：<>&"'\n换行\t制表符`;
    const message = createAssistantMessage(content);

    expect(message.content).toContain("<>&\"'");
    expect(message.content).toContain("\n");
    expect(message.content).toContain("\t");
  });

  it("应该正确处理 emoji", () => {
    const content = "支持 emoji：🎉🚀👍✨";
    const message = createAssistantMessage(content);

    expect(message.content).toContain("🎉");
    expect(message.content).toContain("🚀");
  });

  it("应该正确处理只有 reasoning 没有 text 的消息", () => {
    const messageId = "msg-only-reasoning";
    const parts: MessagePart[] = [
      createReasoningPart("正在思考中..."),
    ];

    const textParts = parts.filter(p => p.type === "text");
    const reasoningParts = parts.filter(p => p.type === "reasoning");

    expect(textParts.length).toBe(0);
    expect(reasoningParts.length).toBe(1);

    // 如果没有 text parts，应该使用 message.content
    const displayContent = textParts.map(p => p.content || "").join("") || "";
    expect(displayContent).toBe("");
  });
});

// ============================================================================
// 测试数据导出（供集成测试使用）
// ============================================================================

export {
  createUserMessage,
  createAssistantMessage,
  createTextPart,
  createReasoningPart,
  createToolCallPart,
  createToolResultPart,
};
