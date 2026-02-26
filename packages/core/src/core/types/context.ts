import type { BaseEnvironment } from "../environment/base/base-environment";

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
   * Callback for storing intermediate messages during agent execution.
   * Called whenever the agent adds an assistant or tool message.
   * Useful for persisting messages to session history in real-time.
   */
  onMessageAdded?: (message: { 
    role: string; 
    content: string; 
    name?: string; 
    tool_call_id?: string; 
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }) => void;
}
