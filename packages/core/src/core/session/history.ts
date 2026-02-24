/**
 * @fileoverview History conversion - Convert Session to Agent Core format.
 *
 * Converts Session messages to the format expected by Agent Core's handle_query.
 * Supports multimodal content (text, images, audio, files).
 *
 * Based on OpenCode's MessageV2.toModelMessages implementation.
 */

import type { Session } from "./session";
import type { MessageWithParts, TextPart, ToolPart, ReasoningPart, FilePart, HistoryMessage, MessageContent, TextContent, ImageContent } from "./types";

/**
 * Convert a session's messages to Agent Core history format.
 *
 * This format is compatible with the `history` parameter of `handle_query`.
 * Supports multimodal content (text, images, audio, files).
 *
 * @param session - The session to convert
 * @returns Array of messages in Agent Core format
 */
export function sessionToHistory(session: Session): HistoryMessage[] {
  const messages = session.getMessages();
  const history: HistoryMessage[] = [];

  for (const msg of messages) {
    const converted = convertMessage(msg);
    if (converted) {
      history.push(converted);
    }
  }

  return history;
}

/**
 * Convert a single message with parts to history format.
 */
function convertMessage(msg: MessageWithParts): HistoryMessage | null {
  switch (msg.info.role) {
    case "user":
      return convertUserMessage(msg);

    case "assistant":
      return convertAssistantMessage(msg);

    case "tool":
      return convertToolMessage(msg);

    case "system":
      return convertSystemMessage(msg);

    default:
      return null;
  }
}

/**
 * Convert a user message to multimodal format.
 */
function convertUserMessage(msg: MessageWithParts): HistoryMessage {
  const contents: MessageContent[] = [];

  for (const part of msg.parts) {
    switch (part.type) {
      case "text":
        contents.push({
          type: "text",
          text: (part as TextPart).text,
        });
        break;

      case "file":
        const filePart = part as FilePart;
        if (filePart.mime.startsWith("image/")) {
          contents.push({
            type: "image",
            image: filePart.url,
            mimeType: filePart.mime,
          });
        } else if (filePart.mime.startsWith("audio/")) {
          contents.push({
            type: "audio",
            audio: filePart.url,
            mimeType: filePart.mime,
          });
        } else if (filePart.mime === "text/plain" || filePart.mime === "application/x-directory") {
          contents.push({
            type: "text",
            text: `[File: ${filePart.filename || filePart.url}]`,
          });
        } else {
          contents.push({
            type: "file",
            url: filePart.url,
            mimeType: filePart.mime,
            filename: filePart.filename,
          });
        }
        break;

      case "compaction":
        contents.push({
          type: "text",
          text: "[Previous conversation history has been summarized]",
        });
        break;

      case "subtask":
        contents.push({
          type: "text",
          text: "[The following tool was executed by the user]",
        });
        break;
    }
  }

  // Default text if no content
  if (contents.length === 0) {
    contents.push({
      type: "text",
      text: "(empty)",
    });
  }

  return {
    role: "user",
    content: contents.length === 1 ? contents[0] : contents,
  };
}

/**
 * Convert an assistant message to multimodal format.
 */
function convertAssistantMessage(msg: MessageWithParts): HistoryMessage {
  const contents: MessageContent[] = [];
  let hasTextContent = false;

  for (const part of msg.parts) {
    switch (part.type) {
      case "text":
        const textPart = part as TextPart;
        if (!textPart.ignored) {
          contents.push({
            type: "text",
            text: textPart.text,
          });
          if (textPart.text) hasTextContent = true;
        }
        break;

      case "reasoning":
        const reasoningPart = part as ReasoningPart;
        contents.push({
          type: "text",
          text: `[Reasoning: ${reasoningPart.text}]`,
        });
        break;

      case "tool":
        const toolPart = part as ToolPart;
        const status = getToolStatusIcon(toolPart.state);
        contents.push({
          type: "text",
          text: `[Tool ${status}: ${toolPart.tool}]`,
        });
        break;

      case "step-start":
        contents.push({
          type: "text",
          text: "---",
        });
        break;

      case "step-finish":
        // Already included via content
        break;
    }
  }

  // Add tool calls summary if there are any
  const toolParts = msg.parts.filter((p): p is ToolPart => p.type === "tool");
  if (toolParts.length > 0) {
    const toolNames = toolParts.map((p) => p.tool).join(", ");
    contents.push({
      type: "text",
      text: `\n[Tool calls: ${toolNames}]`,
    });
  }

  // Ensure we have at least some meaningful content
  const onlyContentIsEmptyText = 
    contents.length === 1 && 
    contents[0].type === "text" && 
    (contents[0] as TextContent).text === "";
  
  if (contents.length === 0 || onlyContentIsEmptyText) {
    contents.length = 0; // Clear contents
    contents.push({
      type: "text",
      text: "(no content)",
    });
  }

  return {
    role: "assistant",
    content: contents.length === 1 ? contents[0] : contents,
  };
}

/**
 * Convert a tool message to multimodal format.
 */
function convertToolMessage(msg: MessageWithParts): HistoryMessage | null {
  const toolPart = msg.parts.find((p): p is ToolPart => p.type === "tool");

  if (!toolPart) {
    return null;
  }

  let content: MessageContent;

  if (toolPart.state === "error") {
    content = {
      type: "text",
      text: `Error: ${toolPart.error || "Unknown error"}`,
    };
  } else if (toolPart.state === "completed") {
    content = {
      type: "text",
      text: toolPart.output || "(no output)",
    };
  } else {
    content = {
      type: "text",
      text: "(tool call pending or running)",
    };
  }

  return {
    role: "tool",
    content,
    name: toolPart.tool,
    tool_call_id: toolPart.callID,
  };
}

/**
 * Convert a system message to multimodal format.
 */
function convertSystemMessage(msg: MessageWithParts): HistoryMessage {
  const textParts = msg.parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text);

  const text = textParts.join("\n").trim() || "(empty)";

  return {
    role: "system",
    content: {
      type: "text",
      text,
    },
  };
}

/**
 * Get a status icon for a tool call state.
 */
function getToolStatusIcon(state: ToolPart["state"]): string {
  switch (state) {
    case "completed":
      return "✓";
    case "error":
      return "✗";
    case "running":
      return "⋯";
    case "pending":
      return "○";
    default:
      return "?";
  }
}

/**
 * Filter messages up to a certain limit.
 * Useful for limiting context window size.
 */
export function filterMessages(
  messages: HistoryMessage[],
  maxMessages: number
): HistoryMessage[] {
  if (messages.length <= maxMessages) {
    return messages;
  }

  return messages.slice(-maxMessages);
}

/**
 * Get the most recent N messages from a session.
 */
export function getRecentHistory(
  session: Session,
  count: number
): HistoryMessage[] {
  const history = sessionToHistory(session);
  return history.slice(-count);
}

/**
 * Check if a session has compacted content (for future use).
 */
export function hasCompactedContent(session: Session): boolean {
  const messages = session.getMessages();
  return messages.some((msg) => msg.parts.some((part) => part.type === "compaction"));
}
