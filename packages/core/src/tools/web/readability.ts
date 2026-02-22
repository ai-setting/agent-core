import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export interface ReadableContent {
  title?: string;
  text: string;
  content?: string;
  excerpt?: string;
  byline?: string;
  siteName?: string;
}

export async function extractReadableContent(
  html: string,
  url: string,
): Promise<ReadableContent> {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article) {
      return { text: stripHtml(html) };
    }

    // Convert null to undefined for type compatibility
    return {
      title: article.title ?? undefined,
      text: article.textContent || "",
      content: article.content ?? undefined,
      excerpt: article.excerpt ?? undefined,
      byline: article.byline ?? undefined,
      siteName: article.siteName ?? undefined,
    };
  } catch {
    return { text: stripHtml(html) };
  }
}

function stripHtml(html: string): string {
  return (
    html
      .replace(/<script[^>]*>.*?<\/script>/gi, "")
      .replace(/<style[^>]*>.*?<\/style>/gi, "")
      .replace(/<noscript[^>]*>.*?<\/noscript>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function isHtml(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return trimmed.startsWith("<!doctype") || trimmed.startsWith("<html");
}

export function markdownToText(markdown: string): string {
  return (
    markdown
      .replace(/^#+\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/`(.+?)`/g, "$1")
      .replace(/\[(.+?)\]\(.+?\)/g, "$1")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .trim()
  );
}

export function truncateText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return { text, truncated: false };
  }

  let truncated = text.slice(0, maxChars);
  const lastPeriod = truncated.lastIndexOf(".");
  const lastNewline = truncated.lastIndexOf("\n");
  const cutoff = Math.max(lastPeriod, lastNewline);

  if (cutoff > maxChars * 0.8) {
    truncated = text.slice(0, cutoff + 1);
  }

  return { text: truncated, truncated: true };
}
