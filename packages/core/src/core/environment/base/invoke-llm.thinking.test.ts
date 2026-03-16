/**
 * @fileoverview Tests for thinkingInText processing in invoke-llm
 */

import { describe, it, expect } from "bun:test";

/**
 * Process thinking tags from text delta
 * Extracts thinking content from text and triggers reasoning events
 * Used for models like MiniMax 2.5 that put thinking in text delta
 * 
 * @param textDelta - The incoming text delta
 * @param config - thinkingInText configuration
 * @returns Cleaned text and extracted thinking content
 */
function processThinkingFromText(
  textDelta: string,
  config: {
    enabled?: boolean;
    tags?: string[];
    removeFromOutput?: boolean;
  }
): { cleanedText: string; thinkingContent?: string } {
  if (!config.enabled || !textDelta) {
    return { cleanedText: textDelta };
  }

  const tags = config.tags || ['thinking'];
  let remainingText = textDelta;
  let extractedThinking = '';

  for (const tag of tags) {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    
    // Match thinking tags (case-insensitive for robustness)
    // Use a regex that captures the content between tags
    const regex = new RegExp(`${openTag}([\\s\\S]*?)${closeTag}`, 'gi');
    const matches = [...remainingText.matchAll(regex)];
    
    for (const match of matches) {
      // match[0] is the full match (including tags)
      // match[1] is the captured content (inside tags)
      const fullMatch = match[0];
      const content = match[1];
      
      if (content) {
        extractedThinking += content;
      }
      
      // Remove the full match (including tags) from output if configured
      if (config.removeFromOutput !== false) {
        remainingText = remainingText.replace(fullMatch, '');
      }
    }
  }

  return {
    cleanedText: remainingText,
    thinkingContent: extractedThinking || undefined
  };
}

describe("processThinkingFromText", () => {
  const defaultConfig = {
    enabled: true,
    tags: ["thinking"],
    removeFromOutput: true
  };

  describe("basic thinking tag extraction", () => {
    it("should extract thinking content from single complete tag", () => {
      const text = "<thinking>Let me think about this.</thinking>Hello world";
      const result = processThinkingFromText(text, defaultConfig);
      
      expect(result.thinkingContent).toBe("Let me think about this.");
      expect(result.cleanedText).toBe("Hello world");
    });

    it("should handle thinking tag at the end", () => {
      const text = "Hello world<thinking>My reasoning</thinking>";
      const result = processThinkingFromText(text, defaultConfig);
      
      expect(result.thinkingContent).toBe("My reasoning");
      expect(result.cleanedText).toBe("Hello world");
    });

    it("should handle thinking tag in the middle", () => {
      const text = "Hello<thinking>reasoning</thinking>world";
      const result = processThinkingFromText(text, defaultConfig);
      
      expect(result.thinkingContent).toBe("reasoning");
      expect(result.cleanedText).toBe("Helloworld");
    });
  });

  describe("multiple thinking tags", () => {
    it("should extract multiple thinking tags in one delta", () => {
      const text = "<thinking>First</thinking>Hello<thinking>Second</thinking>World";
      const result = processThinkingFromText(text, defaultConfig);
      
      // Now with replaceAll, multiple tags should be extracted
      expect(result.thinkingContent).toBe("FirstSecond");
      expect(result.cleanedText).toBe("HelloWorld");
    });
  });

  describe("case sensitivity", () => {
    it("should handle uppercase THINKING tags", () => {
      const text = "<THINKING>Upper case thinking</THINKING>Hello";
      const result = processThinkingFromText(text, defaultConfig);
      
      expect(result.thinkingContent).toBe("Upper case thinking");
      expect(result.cleanedText).toBe("Hello");
    });

    it("should handle mixed case tags", () => {
      const text = "<Thinking>Mixed case</Thinking>Hello";
      const result = processThinkingFromText(text, defaultConfig);
      
      expect(result.thinkingContent).toBe("Mixed case");
      expect(result.cleanedText).toBe("Hello");
    });
  });

  describe("custom tags", () => {
    it("should support custom reasoning tag", () => {
      const text = "<reasoning>My reasoning</reasoning>Hello";
      const result = processThinkingFromText(text, {
        enabled: true,
        tags: ["reasoning"],
        removeFromOutput: true
      });
      
      expect(result.thinkingContent).toBe("My reasoning");
      expect(result.cleanedText).toBe("Hello");
    });

    it("should support multiple custom tags", () => {
      const text = "<thinking>Think 1</thinking><reasoning>Reason 1</reasoning>Hello";
      const result = processThinkingFromText(text, {
        enabled: true,
        tags: ["thinking", "reasoning"],
        removeFromOutput: true
      });
      
      expect(result.thinkingContent).toBe("Think 1Reason 1");
      expect(result.cleanedText).toBe("Hello");
    });
  });

  describe("removeFromOutput option", () => {
    it("should keep thinking tags when removeFromOutput is false", () => {
      const text = "<thinking>My thinking</thinking>Hello";
      const result = processThinkingFromText(text, {
        enabled: true,
        tags: ["thinking"],
        removeFromOutput: false
      });
      
      expect(result.thinkingContent).toBe("My thinking");
      expect(result.cleanedText).toBe("<thinking>My thinking</thinking>Hello");
    });

    it("should default to removing when removeFromOutput is undefined", () => {
      const text = "<thinking>My thinking</thinking>Hello";
      const result = processThinkingFromText(text, {
        enabled: true,
        tags: ["thinking"]
        // removeFromOutput is undefined (should default to true)
      });
      
      expect(result.thinkingContent).toBe("My thinking");
      expect(result.cleanedText).toBe("Hello");
    });
  });

  describe("disabled config", () => {
    it("should return original text when enabled is false", () => {
      const text = "<thinking>My thinking</thinking>Hello";
      const result = processThinkingFromText(text, {
        enabled: false,
        tags: ["thinking"]
      });
      
      expect(result.thinkingContent).toBeUndefined();
      expect(result.cleanedText).toBe("<thinking>My thinking</thinking>Hello");
    });

    it("should return original text when enabled is undefined", () => {
      const text = "<thinking>My thinking</thinking>Hello";
      const result = processThinkingFromText(text, {
        tags: ["thinking"]
      });
      
      expect(result.thinkingContent).toBeUndefined();
      expect(result.cleanedText).toBe("<thinking>My thinking</thinking>Hello");
    });
  });

  describe("empty and edge cases", () => {
    it("should handle empty text", () => {
      const result = processThinkingFromText("", defaultConfig);
      
      expect(result.cleanedText).toBe("");
      expect(result.thinkingContent).toBeUndefined();
    });

    it("should handle text without thinking tags", () => {
      const text = "Hello world";
      const result = processThinkingFromText(text, defaultConfig);
      
      expect(result.cleanedText).toBe("Hello world");
      expect(result.thinkingContent).toBeUndefined();
    });

    it("should handle incomplete thinking tag (open only)", () => {
      const text = "<thinking>Incomplete";
      const result = processThinkingFromText(text, defaultConfig);
      
      expect(result.cleanedText).toBe("<thinking>Incomplete");
      expect(result.thinkingContent).toBeUndefined();
    });

    it("should handle incomplete thinking tag (close only)", () => {
      const text = "Incomplete</thinking>";
      const result = processThinkingFromText(text, defaultConfig);
      
      expect(result.cleanedText).toBe("Incomplete</thinking>");
      expect(result.thinkingContent).toBeUndefined();
    });

    it("should handle nested tags (should not extract)", () => {
      // The regex is non-greedy, so it should extract inner content only
      const text = "<thinking><inner>Inner</inner></thinking>Hello";
      const result = processThinkingFromText(text, defaultConfig);
      
      expect(result.thinkingContent).toBe("<inner>Inner</inner>");
      expect(result.cleanedText).toBe("Hello");
    });
  });

  describe("special characters in thinking content", () => {
    it("should handle newlines in thinking", () => {
      const text = "<thinking>Line 1\nLine 2\nLine 3</thinking>Hello";
      const result = processThinkingFromText(text, defaultConfig);
      
      expect(result.thinkingContent).toBe("Line 1\nLine 2\nLine 3");
      expect(result.cleanedText).toBe("Hello");
    });

    it("should handle special characters in thinking", () => {
      const text = "<thinking>Special: <>&\"' chars</thinking>Hello";
      const result = processThinkingFromText(text, defaultConfig);
      
      expect(result.thinkingContent).toBe("Special: <>&\"' chars");
      expect(result.cleanedText).toBe("Hello");
    });

    it("should handle unicode in thinking", () => {
      const text = "<thinking>中文内容 🎉</thinking>Hello";
      const result = processThinkingFromText(text, defaultConfig);
      
      expect(result.thinkingContent).toBe("中文内容 🎉");
      expect(result.cleanedText).toBe("Hello");
    });
  });

  describe("streaming simulation - multiple deltas", () => {
    it("should NOT handle streaming across deltas - requires caller state", () => {
      // NOTE: This test documents the limitation.
      // Single function call cannot handle tags that span multiple deltas.
      // The caller (invoke-llm) must maintain state and accumulate reasoning content.
      // 
      // This test verifies that the function correctly handles each delta in isolation.
      // For cross-delta thinking, the caller accumulates reasoningContent across deltas.
      
      const delta1 = "<thinking>Thinking step 1"; // Opening tag only
      const delta2 = " and step 2</thinking>Hello"; // Closing tag
      
      const result1 = processThinkingFromText(delta1, defaultConfig);
      const result2 = processThinkingFromText(delta2, defaultConfig);
      
      // Delta 1: has opening tag but no closing tag - returns as-is
      expect(result1.thinkingContent).toBeUndefined();
      expect(result1.cleanedText).toBe("<thinking>Thinking step 1");
      
      // Delta 2: has closing tag but no opening tag in this delta
      // The function finds no complete tags in this delta alone
      // This is expected behavior - caller must handle the state
      expect(result2.cleanedText).toBe(" and step 2</thinking>Hello");
    });

    it("should correctly handle independent thinking blocks in different deltas", () => {
      // When each delta has a complete thinking block, it works correctly
      const delta1 = "<thinking>First thought</thinking>Response1";
      const delta2 = "<thinking>Second thought</thinking>Response2";
      
      const result1 = processThinkingFromText(delta1, defaultConfig);
      const result2 = processThinkingFromText(delta2, defaultConfig);
      
      expect(result1.thinkingContent).toBe("First thought");
      expect(result1.cleanedText).toBe("Response1");
      
      expect(result2.thinkingContent).toBe("Second thought");
      expect(result2.cleanedText).toBe("Response2");
    });

    it("caller should accumulate reasoning content across deltas", () => {
      // This test simulates the caller's responsibility to accumulate reasoning
      // Each complete thinking block is extracted, caller joins them
      
      const deltas = [
        "<thinking>First</thinking>Hello",
        "<thinking>Second</thinking>World",
      ];
      
      let accumulatedReasoning = "";
      
      for (const delta of deltas) {
        const result = processThinkingFromText(delta, defaultConfig);
        if (result.thinkingContent) {
          accumulatedReasoning += result.thinkingContent;
        }
      }
      
      // Caller correctly accumulates all thinking content
      expect(accumulatedReasoning).toBe("FirstSecond");
    });
  });
});
