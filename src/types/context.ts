export interface Context {
  session_id: string;
  timestamp: string;
  workdir?: string;
  user_id?: string;
  abort?: AbortSignal;
  metadata?: Record<string, unknown>;
}
