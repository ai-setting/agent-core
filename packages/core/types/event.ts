export type EventRole = "user" | "assistant" | "system" | "tool" | "agent";

export interface Event {
  event_type: string;
  timestamp: string;
  role: EventRole;
  content: string | Record<string, unknown>;
  event_id?: string;
  message_id?: string;
  name?: string;
  attachments?: Attachment[];
  metadata?: Record<string, unknown>;
}

export interface Attachment {
  type: string;
  url: string;
  name?: string;
}
