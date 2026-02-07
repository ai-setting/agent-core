export interface Action {
  tool_name: string;
  args: Record<string, unknown>;
  action_id?: string;
  timestamp?: string;
  thought?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}
