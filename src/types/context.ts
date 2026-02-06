export interface Context {
  timestamp?: string;
  workdir?: string;
  user_id?: string;
  session_id?: string;
  abort?: AbortSignal;
  metadata?: Record<string, unknown>;
}
