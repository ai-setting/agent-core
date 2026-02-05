export type LLMStreamEventType =
  | "start"
  | "reasoning-start"
  | "reasoning-delta"
  | "reasoning-end"
  | "text-delta"
  | "text-done"
  | "tool-call"
  | "tool-result"
  | "completed"
  | "error";

export interface LLMStreamEvent {
  type: LLMStreamEventType;
  content?: string;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  error?: string;
}

export type StreamHandler = (event: LLMStreamEvent) => void;

export interface LLMStream {
  id: string;
  events: AsyncGenerator<LLMStreamEvent, void, unknown>;
  push(event: LLMStreamEvent): void;
  complete(): void;
  error(error: string): void;
}
