/**
 * @fileoverview History conversion - Convert Session to AI SDK ModelMessage format.
 *
 * Converts Session messages to AI SDK ModelMessage format for direct use with LLM APIs.
 * This eliminates the need for format conversion in invoke_llm.ts.
 */

import type { ModelMessage } from "ai";
import type { Session } from "./session";
import type { MessageWithParts, TextPart, ToolPart, ReasoningPart, FilePart } from "./types";
import { createLogger } from "../../utils/logger.js";

const historyLogger = createLogger("history", "server.log");

/**
 * Normalize toolCallId to be compatible with all LLM providers.
 * Replaces special characters (like colon) with underscores.
 */
function normalizeToolCallId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Convert a session's messages to AI SDK ModelMessage format.
 *
 * @param session - The session to convert
 * @returns Array of messages in AI SDK ModelMessage format
 */
export function sessionToHistory(session: Session): ModelMessage[] {
  const messages = session.getMessages();
  const history: ModelMessage[] = [];

  for (const msg of messages) {
    const converted = convertMessage(msg);
    if (converted) {
      history.push(converted);
    }
  }

  historyLogger.debug("[sessionToHistory] Converted session to history", {
    sessionId: session.id,
    inputMessageCount: messages.length,
    outputHistoryCount: history.length,
  });

  return history;
}

/**
 * Convert a single message with parts to AI SDK ModelMessage format.
 */
function convertMessage(msg: MessageWithParts): ModelMessage | null {
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
      historyLogger.warn("[convertMessage] Unknown message role", {
        role: msg.info.role,
        messageId: msg.info.id,
      });
      return null;
  }
}

/**
 * Convert a user message to AI SDK ModelMessage format.
 */
function convertUserMessage(msg: MessageWithParts): ModelMessage {
  const parts: any[] = [];

  for (const part of msg.parts) {
    switch (part.type) {
      case "text": {
        const textPart = part as TextPart;
        if (!textPart.ignored) {
          parts.push({ type: "text", text: textPart.text });
        }
        break;
      }

      case "file": {
        const filePart = part as FilePart;
        // Skip text/plain and directory files
        if (filePart.mime !== "text/plain" && filePart.mime !== "application/x-directory") {
          parts.push({
            type: "file",
            url: filePart.url,
            mediaType: filePart.mime,
            filename: filePart.filename,
          });
        }
        break;
      }

      // Note: Image parts are not currently supported in session storage
      // case "image": {
      //   break;
      // }
    }
  }

  // Default text if no content
  if (parts.length === 0) {
    parts.push({ type: "text", text: "(empty)" });
  }

  return {
    role: "user",
    content: parts,
  } as ModelMessage;
}

/**
 * Convert an assistant message to AI SDK ModelMessage format.
 * Tool calls are embedded in content array as tool-call parts.
 */
function convertAssistantMessage(msg: MessageWithParts): ModelMessage {
  const parts: any[] = [];

  for (const part of msg.parts) {
    switch (part.type) {
      case "text": {
        const textPart = part as TextPart;
        if (!textPart.ignored && textPart.text) {
          parts.push({ type: "text", text: textPart.text });
        }
        break;
      }

      case "reasoning": {
        const reasoningPart = part as ReasoningPart;
        // Store reasoning as text for now
        // TODO: Use reasoning type when AI SDK supports it
        parts.push({ type: "text", text: reasoningPart.text });
        break;
      }

      case "tool": {
        const toolPart = part as ToolPart;
        // Assistant messages show tool calls as tool-call parts
        if (toolPart.state === "pending" || toolPart.state === "running") {
          const normalizedCallId = normalizeToolCallId(toolPart.callID || `call_${Date.now()}`);
          historyLogger.debug(`convertAssistantMessage: tool-call callID=${toolPart.callID}, normalized=${normalizedCallId}`);
          parts.push({
            type: "tool-call",
            toolCallId: normalizedCallId,
            toolName: toolPart.tool,
            input: toolPart.input || {},
          });
        }
        break;
      }
    }
  }

  // Ensure we have at least some content
  if (parts.length === 0) {
    parts.push({ type: "text", text: "(no content)" });
  }

  return {
    role: "assistant",
    content: parts,
  } as ModelMessage;
}

/**
 * Convert a tool message to AI SDK ModelMessage format.
 */
function convertToolMessage(msg: MessageWithParts): ModelMessage | null {
  const toolPart = msg.parts.find((p): p is ToolPart => p.type === "tool");

  if (!toolPart) {
    historyLogger.warn("[convertToolMessage] No tool part found in tool message", {
      messageId: msg.info.id,
      role: msg.info.role,
      partsCount: msg.parts.length,
      partsTypes: msg.parts.map((p) => p.type),
    });
    return null;
  }

  if (!toolPart.callID) {
    historyLogger.warn("[convertToolMessage] Tool part missing callID", {
      messageId: msg.info.id,
      toolName: toolPart.tool,
      state: toolPart.state,
    });
  }

  let resultText: string;

  if (toolPart.state === "error") {
    resultText = `Error: ${toolPart.error || "Unknown error"}`;
  } else if (toolPart.state === "completed") {
    resultText = toolPart.output || "(no output)";
  } else {
    resultText = "(tool call pending or running)";
  }

  const normalizedCallId = normalizeToolCallId(toolPart.callID || "");
  historyLogger.debug(`convertToolMessage: tool-result callID=${toolPart.callID}, normalized=${normalizedCallId}, state=${toolPart.state}`);

  return {
    role: "tool",
    content: [{ 
      type: "tool-result", 
      toolCallId: normalizedCallId, 
      toolName: toolPart.tool,
      output: { type: "text", value: resultText }
    }],
    toolCallId: normalizedCallId,
  } as unknown as ModelMessage;
}

/**
 * Convert a system message to AI SDK ModelMessage format.
 */
function convertSystemMessage(msg: MessageWithParts): ModelMessage {
  const textParts = msg.parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text);

  const text = textParts.join("\n").trim() || "(empty)";

  return {
    role: "system",
    content: text,
  } as unknown as ModelMessage;
}

/**
 * Filter messages up to a certain limit.
 * Useful for limiting context window size.
 */
export function filterMessages(messages: ModelMessage[], maxMessages: number): ModelMessage[] {
  if (messages.length <= maxMessages) {
    return messages;
  }

  // Keep the most recent messages
  return messages.slice(-maxMessages);
}

/**
 * Get the last N user messages from the history.
 */
export function getLastUserMessages(messages: ModelMessage[], count: number): ModelMessage[] {
  return messages.filter((m) => m.role === "user").slice(-count);
}

/**
 * Get recent history (last N messages).
 * @deprecated Use filterMessages instead
 */
export function getRecentHistory(messages: ModelMessage[], maxMessages: number): ModelMessage[] {
  return filterMessages(messages, maxMessages);
}

/**
 * Check if history has compacted content.
 * @returns Always false for now (compaction not implemented)
 */
export function hasCompactedContent(_messages: ModelMessage[]): boolean {
  return false;
}

/**
 * Format a message for display (debug/logging).
 */
export function formatMessageForDisplay(msg: ModelMessage): string {
  if (typeof msg.content === "string") {
    return msg.content.substring(0, 100);
  }

  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part: any) => {
        if (part.type === "text") return part.text;
        if (part.type === "tool-call") return `[Tool: ${part.toolName}]`;
        if (part.type === "tool-result") return `[Tool Result]`;
        return `[${part.type}]`;
      })
      .join(" ")
      .substring(0, 100);
  }

  return JSON.stringify(msg.content).substring(0, 100);
}
