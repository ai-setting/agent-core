import type { BaseEnvironment } from "../environment/base/base-environment";
import type { ModelMessage } from "ai";

export interface Context {
  timestamp?: string;
  workdir?: string;
  user_id?: string;
  session_id?: string;
  message_id?: string;
  abort?: AbortSignal;
  metadata?: Record<string, unknown>;
  env?: BaseEnvironment;
  /**
   * Agent type for behavior spec selection.
   * Used by subagents to load their specific prompts.
   */
  agentType?: string;
  /**
   * Callback for storing intermediate messages during agent execution.
   * Called whenever the agent adds an assistant or tool message.
   * Useful for persisting messages to session history in real-time.
   * @param message - The message in AI SDK ModelMessage format
   */
  onMessageAdded?: (message: ModelMessage) => void;
}
