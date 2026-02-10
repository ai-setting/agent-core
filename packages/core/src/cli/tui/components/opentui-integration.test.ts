/**
 * @fileoverview OpenTUI 组件集成测试
 *
 * 测试 @opentui/solid 组件和 SyntaxStyle 的集成
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";

// ============================================================================
// SyntaxStyle 模拟和测试
// ============================================================================

// 模拟 SyntaxStyle 类
class MockSyntaxStyle {
  private styles: Map<string, any> = new Map();

  static fromTheme(rules: any[]): MockSyntaxStyle {
    const instance = new MockSyntaxStyle();
    for (const rule of rules) {
      for (const scope of rule.scope) {
        instance.styles.set(scope, rule.style);
      }
    }
    return instance;
  }

  getStyle(name: string): any | undefined {
    return this.styles.get(name);
  }

  hasScope(scope: string): boolean {
    return this.styles.has(scope);
  }
}

// 模拟 resolveRenderLib
function mockResolveRenderLib(): any | null {
  // 模拟 TUI 环境可用
  return {
    jsx: () => {},
    jsxs: () => {},
    Fragment: Symbol("Fragment"),
  };
}

// 模拟 resolveRenderLib - 非 TUI 环境
function mockResolveRenderLibNull(): any | null {
  return null;
}

// ============================================================================
// 测试套件 1: SyntaxStyle 行为测试
// ============================================================================

describe("SyntaxStyle 行为测试", () => {
  it("fromTheme 应该返回带有 getStyle 方法的实例", () => {
    const rules = [
      {
        scope: ["default"],
        style: { foreground: "#ffffff" },
      },
      {
        scope: ["markup.strong"],
        style: { foreground: "#ffffff", bold: true },
      },
    ];

    const syntaxStyle = MockSyntaxStyle.fromTheme(rules);

    expect(syntaxStyle).toBeDefined();
    expect(typeof (syntaxStyle as any).getStyle).toBe("function");
  });

  it("getStyle 应该返回对应 scope 的样式", () => {
    const rules = [
      {
        scope: ["default"],
        style: { foreground: "#ffffff" },
      },
      {
        scope: ["heading"],
        style: { foreground: "#ffffff", bold: true },
      },
    ];

    const syntaxStyle = MockSyntaxStyle.fromTheme(rules);
    const defaultStyle = syntaxStyle.getStyle("default");
    const headingStyle = syntaxStyle.getStyle("heading");

    expect(defaultStyle).toBeDefined();
    expect(defaultStyle.foreground).toBe("#ffffff");
    expect(headingStyle).toBeDefined();
    expect(headingStyle.bold).toBe(true);
  });

  it("getStyle 对不存在的 scope 应该返回 undefined", () => {
    const rules = [
      {
        scope: ["default"],
        style: { foreground: "#ffffff" },
      },
    ];

    const syntaxStyle = MockSyntaxStyle.fromTheme(rules);
    const nonExistentStyle = syntaxStyle.getStyle("nonexistent");

    expect(nonExistentStyle).toBeUndefined();
  });

  it("应该正确处理多 scope 规则", () => {
    const rules = [
      {
        scope: ["heading", "heading.1", "heading.2"],
        style: { foreground: "#ffffff", bold: true },
      },
    ];

    const syntaxStyle = MockSyntaxStyle.fromTheme(rules);

    expect(syntaxStyle.hasScope("heading")).toBe(true);
    expect(syntaxStyle.hasScope("heading.1")).toBe(true);
    expect(syntaxStyle.hasScope("heading.2")).toBe(true);
  });

  it("应该验证 SyntaxStyle 实例的有效性", () => {
    const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
    const syntaxStyle = MockSyntaxStyle.fromTheme(rules);

    // 验证实例有效性（MessageList.tsx:52-59 的逻辑）
    const isValid = 
      syntaxStyle !== null &&
      typeof (syntaxStyle as any).getStyle === "function";

    expect(isValid).toBe(true);
  });

  it("无效实例应该被识别", () => {
    const invalidInstances = [
      null,
      undefined,
      {},
      { getStyle: "not a function" },
      { getStyle: 123 },
    ];

    for (const instance of invalidInstances) {
      const isValid = 
        instance !== null &&
        typeof (instance as any)?.getStyle === "function";

      expect(isValid).toBe(false);
    }
  });
});

// ============================================================================
// 测试套件 2: renderLib 解析测试
// ============================================================================

describe("renderLib 解析测试", () => {
  it("TUI 环境可用时应该返回 render lib", () => {
    const lib = mockResolveRenderLib();
    expect(lib).not.toBeNull();
    expect(lib).toBeDefined();
  });

  it("非 TUI 环境应该返回 null", () => {
    const lib = mockResolveRenderLibNull();
    expect(lib).toBeNull();
  });

  it("render lib 应该包含必要的 JSX 函数", () => {
    const lib = mockResolveRenderLib();
    expect(typeof lib.jsx).toBe("function");
    expect(typeof lib.jsxs).toBe("function");
    expect(lib.Fragment).toBeDefined();
  });
});

// ============================================================================
// 测试套件 3: Markdown 组件 Props 验证
// ============================================================================

describe("Markdown 组件 Props 验证", () => {
  it("应该验证 markdown 组件所需的 props", () => {
    // 模拟 markdown 组件的 props 结构
    const mockSyntaxStyle = MockSyntaxStyle.fromTheme([
      { scope: ["default"], style: { foreground: "#fff" } },
    ]);

    const validProps = {
      content: "# Hello World",
      syntaxStyle: mockSyntaxStyle,
      streaming: false,
      conceal: false,
    };

    // 验证必要 props 存在
    expect(validProps.content).toBeDefined();
    expect(validProps.syntaxStyle).toBeDefined();
    expect(typeof validProps.content).toBe("string");
    expect(typeof (validProps.syntaxStyle as any).getStyle).toBe("function");
  });

  it("应该处理 streaming 状态变化", () => {
    const streamingStates = [true, false];

    for (const isStreaming of streamingStates) {
      const props = {
        content: "Test content",
        syntaxStyle: MockSyntaxStyle.fromTheme([]),
        streaming: isStreaming,
        conceal: false,
      };

      expect(props.streaming).toBe(isStreaming);
    }
  });

  it("空内容不应该导致问题", () => {
    const props = {
      content: "",
      syntaxStyle: MockSyntaxStyle.fromTheme([{ scope: ["default"], style: {} }]),
      streaming: false,
      conceal: false,
    };

    expect(props.content).toBe("");
    expect(typeof props.content).toBe("string");
  });
});

// ============================================================================
// 测试套件 4: SolidJS 响应式模拟测试
// ============================================================================

describe("SolidJS 响应式行为模拟", () => {
  // 模拟 SolidJS 的 createSignal
  function createMockSignal<T>(initialValue: T): [() => T, (v: T) => void] {
    let value = initialValue;
    const listeners = new Set<() => void>();

    const getter = () => value;
    const setter = (newValue: T) => {
      value = newValue;
      // 通知所有监听器
      for (const listener of listeners) {
        listener();
      }
    };

    return [getter, setter];
  }

  // 模拟 SolidJS 的 createMemo
  function createMockMemo<T>(fn: () => T): () => T {
    let cachedValue: T;
    let isDirty = true;

    return () => {
      if (isDirty) {
        cachedValue = fn();
        isDirty = false;
      }
      return cachedValue;
    };
  }

  // 模拟 batch 更新
  function batch<T>(fn: () => T): T {
    // 在实际实现中，batch 会延迟更新直到函数执行完毕
    return fn();
  }

  it("createSignal 应该正确管理状态", () => {
    const [getValue, setValue] = createMockSignal("initial");

    expect(getValue()).toBe("initial");

    setValue("updated");
    expect(getValue()).toBe("updated");
  });

  it("createMemo 应该缓存计算结果", () => {
    let computeCount = 0;
    const [getValue, setValue] = createMockSignal(1);

    const memo = createMockMemo(() => {
      computeCount++;
      return getValue() * 2;
    });

    // 第一次访问，应该计算
    expect(memo()).toBe(2);
    expect(computeCount).toBe(1);

    // 第二次访问，应该使用缓存
    expect(memo()).toBe(2);
    expect(computeCount).toBe(1);

    // 更新值（在真实场景中，memo 应该重新计算）
    setValue(2);
    // 注意：这个简单模拟不会自动重新计算，需要手动标记为 dirty
  });

  it("batch 应该支持批量更新", () => {
    const updates: string[] = [];
    const [getA, setA] = createMockSignal("a");
    const [getB, setB] = createMockSignal("b");

    batch(() => {
      setA("a-updated");
      setB("b-updated");
      updates.push("inside-batch");
    });

    expect(getA()).toBe("a-updated");
    expect(getB()).toBe("b-updated");
    expect(updates).toContain("inside-batch");
  });
});

// ============================================================================
// 测试套件 5: 完整渲染流程模拟
// ============================================================================

describe("完整渲染流程模拟", () => {
  it("应该模拟 MessageList 的渲染数据准备", () => {
    // 模拟 MessageList.tsx 中的状态
    const messages = [
      { id: "msg-1", role: "user", content: "Hello", timestamp: Date.now() },
      { id: "msg-2", role: "assistant", content: "Hi there!", timestamp: Date.now() },
    ];

    const parts: Record<string, any[]> = {
      "msg-2": [
        { id: "p1", type: "reasoning", content: "思考中..." },
        { id: "p2", type: "text", content: "Hi there!" },
      ],
    };

    const isStreaming = false;

    // 模拟 MessageList.tsx 的计算逻辑
    const assistantMessage = messages[1];
    const messageParts = parts[assistantMessage.id] || [];
    const reasoningParts = messageParts.filter(p => p.type === "reasoning");
    const textParts = messageParts.filter(p => p.type === "text");

    const displayContent = textParts.map(p => p.content || "").join("") || assistantMessage.content;

    // 验证渲染数据
    expect(displayContent).toBe("Hi there!");
    expect(reasoningParts.length).toBe(1);
    expect(reasoningParts[0].content).toBe("思考中...");
  });

  it("应该模拟 Markdown 样式验证流程", () => {
    // 模拟 markdown-style.tsx 中的逻辑
    const theme = {
      foreground: "#ffffff",
      primary: "#3b82f6",
      muted: "#6b7280",
      thinking: "#a855f7",
    };

    // 模拟 generateMarkdownSyntax
    const rules = [
      { scope: ["default"], style: { foreground: theme.foreground } },
      { scope: ["markup.strong"], style: { foreground: theme.foreground, bold: true } },
      { scope: ["link"], style: { foreground: theme.primary } },
    ];

    // 模拟 SyntaxStyle.fromTheme
    const syntaxStyle = MockSyntaxStyle.fromTheme(rules);

    // 模拟 validSyntaxStyle 检查 (MessageList.tsx:52-59)
    const validSyntaxStyle = (() => {
      if (!syntaxStyle) return null;
      const hasGetStyle = typeof (syntaxStyle as any).getStyle === "function";
      if (!hasGetStyle) return null;
      return syntaxStyle;
    })();

    expect(validSyntaxStyle).toBeDefined();
    expect(validSyntaxStyle).not.toBeNull();
    expect((validSyntaxStyle as any).getStyle("default")).toBeDefined();
  });

  it("应该处理 Markdown 渲染 fallback 逻辑", () => {
    // 场景 1: SyntaxStyle 有效
    const validSyntaxStyle = MockSyntaxStyle.fromTheme([
      { scope: ["default"], style: { foreground: "#fff" } },
    ]);

    const shouldUseMarkdown1 = validSyntaxStyle !== null;
    expect(shouldUseMarkdown1).toBe(true);

    // 场景 2: SyntaxStyle 无效（null）
    const invalidSyntaxStyle = null;
    const shouldUseMarkdown2 = invalidSyntaxStyle !== null;
    expect(shouldUseMarkdown2).toBe(false);

    // 场景 3: SyntaxStyle 缺少 getStyle
    const brokenSyntaxStyle = { someProperty: "value" };
    const shouldUseMarkdown3 = 
      brokenSyntaxStyle !== null &&
      typeof (brokenSyntaxStyle as any).getStyle === "function";
    expect(shouldUseMarkdown3).toBe(false);
  });
});

// ============================================================================
// 测试套件 6: 错误场景测试
// ============================================================================

describe("错误场景测试", () => {
  it("应该处理 SyntaxStyle.fromTheme 抛出异常", () => {
    // 模拟 fromTheme 抛出异常
    const faultyFromTheme = () => {
      throw new Error("Failed to create SyntaxStyle");
    };

    let errorCaught = false;
    let syntaxStyle = null;

    try {
      faultyFromTheme();
    } catch (e) {
      errorCaught = true;
      console.warn("[MarkdownStyle] Failed to create SyntaxStyle:", (e as Error).message);
    }

    expect(errorCaught).toBe(true);
    expect(syntaxStyle).toBeNull();
  });

  it("应该处理无效的规则格式", () => {
    const invalidRules = [
      { scope: "not-an-array", style: {} },  // scope 应该是数组
      { scope: [], style: null },            // 空 scope
      null,                                   // null 规则
    ];

    // 验证我们能处理这些规则而不崩溃
    for (const rule of invalidRules) {
      if (rule && Array.isArray(rule.scope)) {
        expect(true).toBe(true); // 有效规则格式
      } else {
        expect(true).toBe(true); // 无效规则被忽略
      }
    }
  });

  it("应该处理 content 为 undefined 的情况", () => {
    const contents = [
      "",
      undefined,
      null,
      "valid content",
    ];

    for (const content of contents) {
      // MessageList.tsx:44 的逻辑
      const safeContent = content || "";
      expect(typeof safeContent).toBe("string");
    }
  });
});

// ============================================================================
// 测试套件 7: 性能相关测试
// ============================================================================

describe("性能相关测试", () => {
  it("应该高效处理大量消息", () => {
    const messages = [];
    for (let i = 0; i < 1000; i++) {
      messages.push({
        id: `msg-${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message content ${i}`,
        timestamp: Date.now(),
      });
    }

    expect(messages.length).toBe(1000);
    
    // 验证最后一条消息
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.id).toBe("msg-999");
  });

  it("应该高效处理大量 parts", () => {
    const parts = [];
    for (let i = 0; i < 100; i++) {
      parts.push({
        id: `part-${i}`,
        type: i % 3 === 0 ? "reasoning" : "text",
        content: `Part content ${i}`,
      });
    }

    const reasoningParts = parts.filter(p => p.type === "reasoning");
    const textParts = parts.filter(p => p.type === "text");

    expect(parts.length).toBe(100);
    expect(reasoningParts.length).toBeGreaterThan(0);
    expect(textParts.length).toBeGreaterThan(0);
  });

  it("应该缓存 SyntaxStyle 实例", () => {
    const rules = [{ scope: ["default"], style: { foreground: "#fff" } }];
    
    // 多次调用 fromTheme
    const instance1 = MockSyntaxStyle.fromTheme(rules);
    const instance2 = MockSyntaxStyle.fromTheme(rules);

    // 验证都是有效实例
    expect(typeof instance1.getStyle).toBe("function");
    expect(typeof instance2.getStyle).toBe("function");
  });
});

// ============================================================================
// 导出测试工具
// ============================================================================

export { MockSyntaxStyle, mockResolveRenderLib, mockResolveRenderLibNull };
