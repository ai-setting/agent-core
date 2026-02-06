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
}
