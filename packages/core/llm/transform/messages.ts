/**
 * @fileoverview Message format transformation for different providers.
 */

export function transformMessages(
  messages: Array<{ role: string; content: unknown; name?: string }>,
  providerID: string,
  modelID: string,
): Array<{ role: string; content: unknown; name?: string }> {
  if (providerID === "anthropic") {
    messages = messages
      .map((msg) => {
        if (typeof msg.content === "string") {
          if (msg.content === "") return undefined;
          return msg;
        }
        if (!Array.isArray(msg.content)) return msg;
        const filtered = (msg.content as Array<{ type: string; text?: string }>).filter((part) => {
          if (part.type === "text" || part.type === "reasoning") {
            return part.text !== "";
          }
          return true;
        });
        if (filtered.length === 0) return undefined;
        return { ...msg, content: filtered };
      })
      .filter((msg): msg is typeof msg & { content: unknown } => msg !== undefined);
  }

  if (modelID.includes("claude")) {
    messages = messages.map((msg) => {
      if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
        msg.content = (msg.content as Array<{ type: string; toolCallId?: string }>).map((part) => {
          if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
            return {
              ...part,
              toolCallId: (part as { toolCallId: string }).toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_"),
            };
          }
          return part;
        });
      }
      return msg;
    });
  }

  if (providerID === "mistral" || modelID.toLowerCase().includes("mistral")) {
    messages = messages.map((msg) => {
      if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
        msg.content = (msg.content as Array<{ type: string; toolCallId?: string }>).map((part) => {
          if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
            const normalizedId = (part as { toolCallId: string }).toolCallId
              .replace(/[^a-zA-Z0-9]/g, "")
              .substring(0, 9)
              .padEnd(9, "0");
            return { ...part, toolCallId: normalizedId };
          }
          return part;
        });
      }
      return msg;
    });
  }

  return messages;
}
