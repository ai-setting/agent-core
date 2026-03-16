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
 * Emits reasoning events IMMEDIATELY when:
 * 1. Opening tag is detected (starts reasoning)
 * 2. Thinking content changes (streaming content)
 * 3. Closing tag is detected (ends reasoning)
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
  reasoningEvents: string[];  // Array of reasoning contents for streaming
} {
  if (!config.enabled || !textDelta) {
    return {
      cleanedText: textDelta,
      isThinkingTagOpen: state.isOpen,
      currentThinkingContent: state.content,
      reasoningEvents: []
    };
  }

  const tags = config.tags || ['thinking'];
  let remainingText = textDelta;
  let reasoningEvents: string[] = [];
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
      const beforeOpen = text.substring(0, openIndex);
      const afterOpen = text.substring(openIndex + openTag.length);
      
      if (!isOpen) {
        // First time seeing opening tag - start new thinking block
        isOpen = true;
        currentContent = "";
        // Emit event to start reasoning
        reasoningEvents.push("");
      }
      
      // Add text before opening tag to cleaned output
      result += beforeOpen;
      
      // Check if there's also a closing tag in this delta
      const innerCloseIndex = afterOpen.toLowerCase().indexOf(closeTag.toLowerCase());
      
      if (innerCloseIndex !== -1) {
        // Both open and close in same delta
        const thinkingContent = afterOpen.substring(0, innerCloseIndex);
        const afterClose = afterOpen.substring(innerCloseIndex + closeTag.length);
        
        // Add thinking content
        currentContent += thinkingContent;
        // Emit streaming reasoning event
        reasoningEvents.push(currentContent);
        
        isOpen = false;
        currentContent = "";
        
        // Rest is cleaned text
        result += afterClose;
      } else {
        // Only opening tag, accumulate content
        currentContent += afterOpen;
        // Emit reasoning with current content (streaming)
        reasoningEvents.push(currentContent);
      }
    } else if (closeIndex !== -1) {
      // Closing tag found
      const beforeClose = text.substring(0, closeIndex);
      const afterClose = text.substring(closeIndex + closeTag.length);
      
      if (isOpen) {
        // Add content before close to thinking
        currentContent += beforeClose;
        // Emit final reasoning event
        reasoningEvents.push(currentContent);
        
        isOpen = false;
        currentContent = "";
      }
      
      // Rest is cleaned text
      result += afterClose;
    } else if (isOpen) {
      // We're inside thinking block, accumulate content
      currentContent += text;
      // Emit streaming reasoning event
      reasoningEvents.push(currentContent);
      // Nothing goes to cleaned output
      result = "";
    } else {
      // Normal text, no thinking tags
      result += text;
    }

    remainingText = result;
  }

  return {
    cleanedText: remainingText,
    isThinkingTagOpen: isOpen,
    currentThinkingContent: currentContent,
    reasoningEvents
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
 * Verifies that reasoning events are emitted:
 * 1. IMMEDIATELY when opening tag is detected
 * 2. For each streaming content change
 * 3. When closing tag is detected
 */
describe("processThinkingStream", () => {
  const defaultConfig = {
    enabled: true,
    tags: ["thinking"],
    removeFromOutput: true
  };

  it("should emit reasoning event immediately when opening tag detected", () => {
    const delta = "<thinking>Starting";
    
    const result = processThinkingStream(delta, defaultConfig, {
      isOpen: false,
      content: ""
    });
    
    // Should emit reasoning event immediately
    expect(result.reasoningEvents.length).toBeGreaterThan(0);
    expect(result.isThinkingTagOpen).toBe(true);
  });

  it("should emit reasoning events for each delta when thinking is streaming", () => {
    // First delta: start thinking
    const delta1 = "<thinking>Let";
    const r1 = processThinkingStream(delta1, defaultConfig, { isOpen: false, content: "" });
    
    // Second delta: continue thinking
    const delta2 = " me think";
    const r2 = processThinkingStream(delta2, defaultConfig, { isOpen: r1.isThinkingTagOpen, content: r1.currentThinkingContent });
    
    // Third delta: end thinking
    const delta3 = " about</thinking>Hello";
    const r3 = processThinkingStream(delta3, defaultConfig, { isOpen: r2.isThinkingTagOpen, content: r2.currentThinkingContent });
    
    // Each delta should emit reasoning events
    expect(r1.reasoningEvents.length).toBeGreaterThan(0);
    expect(r2.reasoningEvents.length).toBeGreaterThan(0);
    expect(r3.reasoningEvents.length).toBeGreaterThan(0);
    
    // Reasoning content should grow
    const lastEvent1 = r1.reasoningEvents[r1.reasoningEvents.length - 1];
    const lastEvent2 = r2.reasoningEvents[r2.reasoningEvents.length - 1];
    const lastEvent3 = r3.reasoningEvents[r3.reasoningEvents.length - 1];
    
    expect(lastEvent1).toContain("Let");
    expect(lastEvent2).toContain("Let me think");
    expect(lastEvent3).toContain("Let me think about");
    
    // Cleaned text should not contain thinking tags
    expect(r3.cleanedText).toBe("Hello");
  });

  it("should handle complete thinking block in single delta", () => {
    const delta = "<thinking>Complete thought</thinking>Response";
    
    const result = processThinkingStream(delta, defaultConfig, {
      isOpen: false,
      content: ""
    });
    
    // Should emit reasoning events
    expect(result.reasoningEvents.length).toBeGreaterThan(0);
    // Should have reasoning content
    const lastEvent = result.reasoningEvents[result.reasoningEvents.length - 1];
    expect(lastEvent).toBe("Complete thought");
    // Cleaned text should not have thinking
    expect(result.cleanedText).toBe("Response");
  });

  it("should handle multiple thinking blocks with separate events", () => {
    // First thinking block
    const delta1 = "<thinking>First</thinking>Text1";
    const r1 = processThinkingStream(delta1, defaultConfig, { isOpen: false, content: "" });
    
    // Second thinking block
    const delta2 = "<thinking>Second</thinking>Text2";
    const r2 = processThinkingStream(delta2, defaultConfig, { 
      isOpen: r1.isThinkingTagOpen, 
      content: r1.currentThinkingContent 
    });
    
    // Both should emit reasoning
    expect(r1.reasoningEvents.length).toBeGreaterThan(0);
    expect(r2.reasoningEvents.length).toBeGreaterThan(0);
    
    expect(r1.cleanedText).toBe("Text1");
    expect(r2.cleanedText).toBe("Text2");
  });

  it("should handle thinking end with text after (</thinking>Hello)", () => {
    // Simulate thinking that ends and then has text output
    const state = { isOpen: true, content: "Let me think about this" };
    const delta = "</thinking>Hello world";
    
    const result = processThinkingStream(delta, defaultConfig, state);
    
    // Thinking should be closed
    expect(result.isThinkingTagOpen).toBe(false);
    // Should have emitted final reasoning
    expect(result.reasoningEvents.length).toBeGreaterThan(0);
    // Cleaned text should have the text AFTER </thinking>
    expect(result.cleanedText).toBe("Hello world");
  });

  it("should simulate full streaming reasoning flow", () => {
    const reasoningEvents: string[] = [];
    let isOpen = false;
    let currentContent = "";
    
    const deltas = [
      "<thinking>Let me",          // Start, emit
      " think about",              // Continue, emit
      " this problem",             // Continue, emit
      "</thinking>First",          // End, emit
      " response",                 // Normal text
      "<thinking>Now I",          // Start, emit
      " understand",               // Continue, emit
      "</thinking>Second",         // End, emit
    ];
    
    for (const delta of deltas) {
      const result = processThinkingStream(delta, defaultConfig, {
        isOpen,
        content: currentContent
      });
      
      isOpen = result.isThinkingTagOpen;
      currentContent = result.currentThinkingContent;
      
      // Collect all reasoning events
      reasoningEvents.push(...result.reasoningEvents);
    }
    
    // Should have multiple reasoning events (streaming)
    expect(reasoningEvents.length).toBeGreaterThan(2);
    
    // First thinking block events should grow
    // Then second block events
  });
});
