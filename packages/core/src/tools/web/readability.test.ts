/**
 * @fileoverview Unit tests for readability content extraction
 */

import { describe, test, expect } from "bun:test";
import {
  extractReadableContent,
  isHtml,
  markdownToText,
  truncateText,
} from "./readability.js";

describe("Readability - isHtml", () => {
  test("should detect HTML doctype", () => {
    expect(isHtml("<!DOCTYPE html><html><body>test</body></html>")).toBe(true);
  });

  test("should detect HTML tag", () => {
    expect(isHtml("<html><body>test</body></html>")).toBe(true);
  });

  test("should reject plain text", () => {
    expect(isHtml("Just plain text content")).toBe(false);
  });

  test("should reject JSON", () => {
    expect(isHtml('{"key": "value"}')).toBe(false);
  });

  test("should handle whitespace", () => {
    expect(isHtml("  <html>  ")).toBe(true);
  });
});

describe("Readability - markdownToText", () => {
  test("should remove headers", () => {
    const markdown = "# Title\n## Subtitle\n### H3";
    expect(markdownToText(markdown)).toBe("Title\nSubtitle\nH3");
  });

  test("should remove bold and italic", () => {
    const markdown = "**bold** and *italic* text";
    expect(markdownToText(markdown)).toBe("bold and italic text");
  });

  test("should remove inline code", () => {
    const markdown = "Use `const x = 1` for declaration";
    expect(markdownToText(markdown)).toBe("Use const x = 1 for declaration");
  });

  test("should extract link text", () => {
    const markdown = "Visit [our website](https://example.com) here";
    expect(markdownToText(markdown)).toBe("Visit our website here");
  });

  test("should remove list markers", () => {
    const markdown = "- item 1\n* item 2\n+ item 3\n1. numbered";
    expect(markdownToText(markdown)).toBe("item 1\nitem 2\nitem 3\nnumbered");
  });
});

describe("Readability - truncateText", () => {
  test("should not truncate short text", () => {
    const text = "Short text";
    const result = truncateText(text, 100);
    expect(result.text).toBe(text);
    expect(result.truncated).toBe(false);
  });

  test("should truncate long text at char limit", () => {
    const text = "A".repeat(200);
    const result = truncateText(text, 100);
    expect(result.text.length).toBeLessThanOrEqual(100);
    expect(result.truncated).toBe(true);
  });

  test("should try to cut at sentence boundary", () => {
    const text = "First sentence. Second sentence. Third sentence.";
    const result = truncateText(text, 15);
    expect(result.text).toBe("First sentence.");
    expect(result.truncated).toBe(true);
  });

  test("should cut at newline if no period", () => {
    const text = "Line 1\nLine 2\nLine 3";
    const result = truncateText(text, 7);
    // Should cut near first newline, result should contain "Line 1"
    expect(result.text).toContain("Line 1");
    expect(result.truncated).toBe(true);
  });
});

describe("Readability - extractReadableContent", () => {
  test("should extract content from simple HTML", async () => {
    const html = `
      <html>
        <head><title>Test Page</title></head>
        <body>
          <nav>Navigation content</nav>
          <article>
            <h1>Main Title</h1>
            <p>This is the main content of the article.</p>
          </article>
          <aside>Sidebar content</aside>
        </body>
      </html>
    `;

    const result = await extractReadableContent(html, "https://example.com");

    expect(result.title).toBe("Test Page");
    expect(result.text).toContain("Main Title");
    expect(result.text).toContain("main content");
    expect(result.text).not.toContain("Navigation content");
    expect(result.text).not.toContain("Sidebar content");
  });

  test("should handle non-HTML content gracefully", async () => {
    const plainText = "Just plain text content without any HTML";
    const result = await extractReadableContent(plainText, "https://example.com");
    expect(result.text).toBe(plainText);
  });

  test("should handle malformed HTML gracefully", async () => {
    const malformedHtml = "<html><body><p>Unclosed paragraph";
    const result = await extractReadableContent(malformedHtml, "https://example.com");
    expect(result.text.length).toBeGreaterThan(0);
  });

  test("should preserve code blocks", async () => {
    const html = `
      <html>
        <body>
          <article>
            <p>Here is some code:</p>
            <pre><code>const x = 1;</code></pre>
          </article>
        </body>
      </html>
    `;

    const result = await extractReadableContent(html, "https://example.com");
    expect(result.text).toContain("const x = 1;");
  });
});
