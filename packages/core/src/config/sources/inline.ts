import type { ConfigSource } from "../source.js";
import type { Config } from "../types.js";

export function createInlineSource(content: string, priority: number = 100): ConfigSource {
  return {
    name: "inline",
    priority,
    load: async () => {
      try {
        return JSON.parse(content);
      } catch (error) {
        console.warn("[Config] Failed to parse inline config:", error);
        return null;
      }
    },
  };
}
