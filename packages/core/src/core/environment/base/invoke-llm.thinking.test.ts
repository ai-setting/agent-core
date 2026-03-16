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

/**
 * Process thinking tags from text delta with streaming support
 * Handles opening/closing tags and emits reasoning events during streaming
 */
function processThinkingStream(
  textDelta: string,
  config: {
    enabled?: boolean;
    tags?: string[];
    removeFromOutput?: boolean;
  },
  state: {
    isOpen: boolean;
    content: string;
  }
): {
  cleanedText: string;
  isThinkingTagOpen: boolean;
  currentThinkingContent: string;
  newReasoningContent?: string;
} {
  if (!config.enabled || !textDelta) {
    return {
      cleanedText: textDelta,
      isThinkingTagOpen: state.isOpen,
      currentThinkingContent: state.content
    };
  }

  const tags = config.tags || ['thinking'];
  let remainingText = textDelta;
  let newReasoningContent: string | undefined;
  let isOpen = state.isOpen;
  let currentContent = state.content;

  for (const tag of tags) {
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;
    
    let text = remainingText;
    let result = "";
    
    // Check if we have an opening tag in current text
    const openIndex = text.toLowerCase().indexOf(openTag.toLowerCase());
    const closeIndex = text.toLowerCase().indexOf(closeTag.toLowerCase());
    
    if (openIndex !== -1 && (closeIndex === -1 || openIndex < closeIndex)) {
      // Opening tag found first
      if (!isOpen) {
        // Start of new thinking block
        isOpen = true;
        currentContent = "";
      }
      // Add text before the opening tag to cleaned output
      result += text.substring(0, openIndex);
      // Skip the opening tag, then check for closing tag in remainder
      const afterOpenTag = text.substring(openIndex + openTag.length);
      
      // Check if closing tag exists in the remaining text
      const innerCloseIndex = afterOpenTag.toLowerCase().indexOf(closeTag.toLowerCase());
      
      if (innerCloseIndex !== -1) {
        // Both opening and closing in same delta
        const thinkingContent = afterOpenTag.substring(0, innerCloseIndex);
        const afterCloseTag = afterOpenTag.substring(innerCloseIndex + closeTag.length);
        
        // Output the thinking
        currentContent += thinkingContent;
        newReasoningContent = currentContent;
        
        isOpen = false;
        currentContent = "";
        
        // Rest is cleaned text
        result += afterCloseTag;
      } else {
        // Only opening tag, content goes to thinking
        currentContent += afterOpenTag;
      }
    } else if (closeIndex !== -1) {
      // Closing tag found
      // Add text before closing tag to thinking content first
      currentContent += text.substring(0, closeIndex);
      
      // Output the thinking content
      if (isOpen && currentContent.length > 0) {
        newReasoningContent = currentContent;
      }
      
      isOpen = false;
      currentContent = "";
      
      // Skip the closing tag
      const afterCloseTag = text.substring(closeIndex + closeTag.length);
      
      // Check if there's more content after (another thinking block)
      const nextOpen = afterCloseTag.toLowerCase().indexOf(openTag.toLowerCase());
      const nextClose = afterCloseTag.toLowerCase().indexOf(closeTag.toLowerCase());
      
      if (nextOpen !== -1 && (nextClose === -1 || nextOpen < nextClose)) {
        // Another thinking block starts
        isOpen = true;
        result += afterCloseTag.substring(0, nextOpen);
        currentContent += afterCloseTag.substring(nextOpen + openTag.length);
      } else {
        // Rest is regular text
        result += afterCloseTag;
      }
    } else if (isOpen) {
      // No complete tag, but we're inside a thinking block
      currentContent += text;
      // Don't add to cleaned output
      result = "";
    } else {
      result += text;
    }

    remainingText = result;
  }

  return {
    cleanedText: remainingText,
    isThinkingTagOpen: isOpen,
    currentThinkingContent: currentContent,
    newReasoningContent
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

    it("should trigger reasoning event when thinking is extracted", () => {
      // Simulate the reasoning event handler behavior in invoke-llm
      const reasoningEvents: string[] = [];
      
      const onReasoning = (content: string) => {
        reasoningEvents.push(content);
      };
      
      const deltas = [
        "<thinking>First step</thinking>Hello",
        "Some text",
        "<thinking>Second step</thinking>World",
      ];
      
      let reasoningContent = "";
      
      for (const delta of deltas) {
        const result = processThinkingFromText(delta, defaultConfig);
        
        // Simulate invoke-llm's logic
        if (result.thinkingContent) {
          reasoningContent += result.thinkingContent;
          onReasoning(reasoningContent);
        }
      }
      
      // Should trigger reasoning event TWICE (once per complete thinking block)
      expect(reasoningEvents).toHaveLength(2);
      expect(reasoningEvents[0]).toBe("First step");
      expect(reasoningEvents[1]).toBe("First stepSecond step");
    });

    it("should NOT trigger reasoning event for incomplete thinking tags", () => {
      const reasoningEvents: string[] = [];
      
      const onReasoning = (content: string) => {
        reasoningEvents.push(content);
      };
      
      // Delta with opening tag only - no complete tag in this delta
      const delta1 = "<thinking>Incomplete thinking starts";
      const result1 = processThinkingFromText(delta1, defaultConfig);
      
      // No reasoning event because tag is not closed
      if (result1.thinkingContent) {
        reasoningEvents.push(result1.thinkingContent);
      }
      
      // Verify the result - should NOT extract anything
      expect(result1.thinkingContent).toBeUndefined();
      expect(result1.cleanedText).toBe("<thinking>Incomplete thinking starts");
      expect(reasoningEvents).toHaveLength(0);
    });

    it("should trigger reasoning event when thinking tag closes in same delta", () => {
      const reasoningEvents: string[] = [];
      
      const onReasoning = (content: string) => {
        reasoningEvents.push(content);
      };
      
      // A delta with complete thinking tag
      const delta1 = "<thinking>Complete thought</thinking>Hello";
      const result1 = processThinkingFromText(delta1, defaultConfig);
      
      if (result1.thinkingContent) {
        onReasoning(result1.thinkingContent);
      }
      
      // Should trigger reasoning event
      expect(reasoningEvents).toHaveLength(1);
      expect(reasoningEvents[0]).toBe("Complete thought");
    });
  });
});

/**
 * Streaming reasoning tests - for processThinkingStream function
 */
describe("processThinkingStream", () => {
  const defaultConfig = {
    enabled: true,
    tags: ["thinking"],
    removeFromOutput: true
  };

  it("should detect opening tag and start reasoning state", () => {
    const delta = "<thinking>Starting";
    
    const result = processThinkingStream(delta, defaultConfig, {
      isOpen: false,
      content: ""
    });
    
    // Should detect opening tag and be in thinking state
    expect(result.isThinkingTagOpen).toBe(true);
    expect(result.currentThinkingContent).toBe("Starting");
    // No new reasoning content yet (waiting for more content or closing tag)
    expect(result.newReasoningContent).toBeUndefined();
    // No cleaned text (thinking content removed)
    expect(result.cleanedText).toBe("");
  });

  it("should output reasoning when closing tag is detected", () => {
    const delta = "end</thinking>Hello";
    
    const result = processThinkingStream(delta, defaultConfig, {
      isOpen: true,
      content: "Startingmore thinking"
    });
    
    // Should close and output final reasoning
    expect(result.isThinkingTagOpen).toBe(false);
    expect(result.currentThinkingContent).toBe("");
    expect(result.newReasoningContent).toBe("Startingmore thinkingend");
    expect(result.cleanedText).toBe("Hello");
  });

  it("should handle complete thinking block in single delta", () => {
    const delta = "<thinking>Complete thought</thinking>Response";
    
    const result = processThinkingStream(delta, defaultConfig, {
      isOpen: false,
      content: ""
    });
    
    // Opening tag detected, content accumulated, then closing tag - output reasoning
    expect(result.isThinkingTagOpen).toBe(false);
    expect(result.newReasoningContent).toBe("Complete thought");
    expect(result.cleanedText).toBe("Response");
  });

  it("should handle multiple thinking blocks", () => {
    // First delta: first thinking block
    const delta1 = "<thinking>First</thinking>Text1";
    const r1 = processThinkingStream(delta1, defaultConfig, { isOpen: false, content: "" });
    
    // Second delta: second thinking block
    const delta2 = "<thinking>Second</thinking>Text2";
    const r2 = processThinkingStream(delta2, defaultConfig, { 
      isOpen: r1.isThinkingTagOpen, 
      content: r1.currentThinkingContent 
    });
    
    // First delta: opens and closes in same delta
    expect(r1.newReasoningContent).toBe("First");
    expect(r1.cleanedText).toBe("Text1");
    
    // Second delta: same
    expect(r2.newReasoningContent).toBe("Second");
    expect(r2.cleanedText).toBe("Text2");
  });

  it("should simulate full streaming reasoning flow", () => {
    // Simulate the full flow as invoke-llm would do
    const reasoningEvents: string[] = [];
    let isOpen = false;
    let currentContent = "";
    
    const deltas = [
      "<thinking>Let me",          // Start thinking
      " think about",              // Continue thinking
      " this problem",             // Continue thinking
      "</thinking>First",          // End thinking, output
      " response",                 // Normal text
      "<thinking>Now I",          // New thinking
      " understand",               // Continue
      "</thinking>Second",         // End thinking
    ];
    
    for (const delta of deltas) {
      const result = processThinkingStream(delta, defaultConfig, {
        isOpen,
        content: currentContent
      });
      
      isOpen = result.isThinkingTagOpen;
      currentContent = result.currentThinkingContent;
      
      if (result.newReasoningContent) {
        reasoningEvents.push(result.newReasoningContent);
      }
    }
    
    // Should have 2 reasoning events (one per thinking block)
    expect(reasoningEvents).toHaveLength(2);
    expect(reasoningEvents[0]).toBe("Let me think about this problem");
    expect(reasoningEvents[1]).toBe("Now I understand");
  });
});
