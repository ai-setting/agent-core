export interface SpanContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export interface SpanAttributes {
  [key: string]: string | number | boolean | undefined;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;

  name: string;
  kind: SpanKind;
  status: SpanStatus;

  startTime: number;
  endTime?: number;

  attributes: SpanAttributes;
  result?: unknown;
  error?: string;

  children?: Span[];
}

export enum SpanKind {
  CLIENT = "client",
  SERVER = "server",
  INTERNAL = "internal",
}

export enum SpanStatus {
  OK = "ok",
  ERROR = "error",
}
