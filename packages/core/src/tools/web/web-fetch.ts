import { z } from "zod";
import type { ToolInfo, ToolResult, ToolContext } from "../../core/types/tool.js";
import { createLogger } from "../../utils/logger.js";
import {
  extractReadableContent,
  isHtml,
  markdownToText,
  truncateText,
} from "./readability.js";

const webFetchLogger = createLogger("webfetch", "tools.log");

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DEFAULT_MAX_CHARS = 50000;
const DEFAULT_TIMEOUT = 30000;
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB

const WebFetchParamsSchema = z.object({
  url: z.string().describe("The URL to fetch content from"),
  format: z
    .enum(["markdown", "text", "html"])
    .default("markdown")
    .describe("Output format"),
  maxChars: z
    .number()
    .optional()
    .describe("Maximum characters to return"),
});

export type WebFetchParams = z.infer<typeof WebFetchParamsSchema>;

export interface WebFetchConfig {
  maxChars?: number;
  timeout?: number;
  userAgent?: string;
}

function getAcceptHeader(format: string): string {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/html;q=0.8, text/plain;q=0.7";
    case "html":
      return "text/html,text/plain;q=0.1";
    case "text":
      return "text/plain,text/html;q=0.1";
    default:
      return "text/markdown,text/html,text/plain";
  }
}

async function fetchWithTimeout(
  url: string,
  timeout: number,
  options?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

function formatOutput(
  text: string,
  title?: string,
  truncated?: boolean,
  url?: string,
): string {
  let output = "";
  if (title) output += `# ${title}\n\n`;
  if (url) output += `Source: ${url}\n\n`;
  output += text;
  if (truncated)
    output += "\n\n[Content truncated due to length limit]";
  return output;
}

export function createWebFetchTool(config?: WebFetchConfig): ToolInfo {
  const maxChars = config?.maxChars ?? DEFAULT_MAX_CHARS;
  const timeout = config?.timeout ?? DEFAULT_TIMEOUT;
  const userAgent = config?.userAgent ?? DEFAULT_USER_AGENT;

  return {
    name: "webfetch",
    description:
      "Fetch and extract readable content from a URL. Uses Readability to extract main content, filtering out ads and navigation. Returns markdown by default.",
    parameters: WebFetchParamsSchema,
    async execute(
      args: z.infer<typeof WebFetchParamsSchema>,
      _ctx: ToolContext,
    ): Promise<ToolResult> {
      const { url, format, maxChars: argsMaxChars } = args;

      webFetchLogger.info("[webfetch] Executing fetch", { url, format, maxChars: argsMaxChars });

      // Validate URL
      if (
        !url.startsWith("http://") &&
        !url.startsWith("https://")
      ) {
        webFetchLogger.warn("[webfetch] Invalid URL scheme", { url });
        return {
          success: false,
          output: "",
          error: "URL must start with http:// or https://",
        };
      }

      try {
        webFetchLogger.debug("[webfetch] Fetching URL", { url, timeout, userAgent });
        
        // Fetch content
        const response = await fetchWithTimeout(url, timeout, {
          headers: {
            "User-Agent": userAgent,
            Accept: getAcceptHeader(format),
          },
        });

        webFetchLogger.info("[webfetch] Response received", { 
          url, 
          status: response.status,
          statusText: response.statusText,
        });

        if (!response.ok) {
          webFetchLogger.error("[webfetch] HTTP error", { 
            url, 
            status: response.status,
            statusText: response.statusText,
          });
          return {
            success: false,
            output: "",
            error: `HTTP ${response.status}: ${response.statusText}`,
          };
        }

        // Check content length
        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
          webFetchLogger.warn("[webfetch] Response too large (content-length header)", { 
            url, 
            contentLength: parseInt(contentLength) 
          });
          return {
            success: false,
            output: "",
            error: "Response too large (>5MB)",
          };
        }

        const text = await response.text();
        webFetchLogger.debug("[webfetch] Content received", { url, contentLength: text.length });

        // Check if response is too large in memory
        if (text.length > MAX_RESPONSE_SIZE) {
          webFetchLogger.warn("[webfetch] Response too large (in memory)", { 
            url, 
            contentLength: text.length 
          });
          return {
            success: false,
            output: "",
            error: "Response too large (>5MB)",
          };
        }

        // Extract content
        let extractedText: string;
        let title: string | undefined;

        if (isHtml(text)) {
          webFetchLogger.debug("[webfetch] Processing HTML content with Readability", { url });
          // Use Readability for HTML content
          const readable = await extractReadableContent(text, url);
          extractedText = readable.text;
          title = readable.title;
          webFetchLogger.info("[webfetch] Readability extraction complete", { 
            url, 
            title: title || "(no title)",
            extractedLength: extractedText.length 
          });

          // Convert format
          if (format === "text") {
            extractedText = markdownToText(extractedText);
          } else if (format === "html") {
            extractedText = text; // Return original HTML
          }
          // markdown: keep Readability output
        } else {
          // Non-HTML content (JSON, plain text, etc.)
          extractedText = text;
          webFetchLogger.debug("[webfetch] Non-HTML content", { url, contentType: "text/plain" });
        }

        // Truncate if needed
        const effectiveMaxChars = argsMaxChars ?? maxChars;
        const { truncated, text: finalText } = truncateText(
          extractedText,
          effectiveMaxChars,
        );

        webFetchLogger.info("[webfetch] Fetch complete", { 
          url, 
          originalLength: extractedText.length,
          finalLength: finalText.length,
          truncated,
        });

        return {
          success: true,
          output: formatOutput(finalText, title, truncated, url),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        webFetchLogger.error("[webfetch] Fetch failed", { url, error: message });
        return {
          success: false,
          output: "",
          error: message,
        };
      }
    },
  };
}
