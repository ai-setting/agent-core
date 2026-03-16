import { Span, SpanContext, SpanAttributes, SpanKind, SpanStatus } from "./span.js";
import { SpanStorage, InMemorySpanStorage, SQLiteSpanStorage, TraceInfo } from "./span-storage.js";
import { getTraceContext } from "./trace-context.js";

export interface ISpanCollector {
  startSpan(name: string, attributes?: SpanAttributes): SpanContext;
  endSpan(context: SpanContext, result?: unknown, error?: Error): void;
  getCurrentContext(): SpanContext | undefined;
  getTrace(traceId: string): Span[];
  getCurrentTrace(): Span[];
  listTraces(limit?: number): TraceInfo[];
  clearTrace(traceId: string): void;
  exportTrace(traceId: string): string;
  formatTrace(traceId: string): string;
  formatTraceTable(): string;
}

/**
 * Get span storage based on environment variable.
 * - AGENT_CORE_SPAN_STORAGE=memory -> use InMemorySpanStorage
 * - Otherwise (default) -> use SQLiteSpanStorage with path from ConfigPaths
 */
function createSpanStorage(): SpanStorage {
  const storageType = process.env.AGENT_CORE_SPAN_STORAGE?.toLowerCase();
  
  if (storageType === "memory") {
    return new InMemorySpanStorage();
  }
  
  // Default: SQLite storage
  const dbPath = process.env.AGENT_CORE_SPAN_DB_PATH || undefined;
  return new SQLiteSpanStorage(dbPath);
}

export class SpanCollector implements ISpanCollector {
  private storage: SpanStorage;
  private currentContext: SpanContext | undefined;
  private activeSpans = new Map<string, Span>();

  constructor(storage?: SpanStorage) {
    this.storage = storage || createSpanStorage();
  }

  async initialize(): Promise<void> {
    await this.storage.initialize();
  }

  startSpan(name: string, attributes?: SpanAttributes): SpanContext {
    const traceCtx = getTraceContext();
    const traceId = traceCtx?.getRequestId() || this.generateTraceId();
    const spanId = this.generateSpanId();

    const context: SpanContext = {
      traceId,
      spanId,
      parentSpanId: this.currentContext?.spanId,
    };

    const span: Span = {
      traceId,
      spanId,
      parentSpanId: context.parentSpanId,
      name,
      kind: SpanKind.INTERNAL,
      status: SpanStatus.OK,
      startTime: Date.now(),
      attributes: attributes || {},
      children: [],
    };

    if (context.parentSpanId) {
      const parentSpan = this.activeSpans.get(context.parentSpanId);
      if (parentSpan) {
        parentSpan.children!.push(span);
      }
    }

    this.activeSpans.set(spanId, span);
    this.currentContext = context;
    this.storage.save(span);

    return context;
  }

  endSpan(context: SpanContext, result?: unknown, error?: Error): void {
    const span = this.activeSpans.get(context.spanId);
    if (!span) return;

    span.endTime = Date.now();
    span.status = error ? SpanStatus.ERROR : SpanStatus.OK;

    if (result !== undefined) {
      span.result = result;
    }
    if (error) {
      span.error = error.message;
    }

    // Re-save to storage with updated children (if any)
    this.storage.save(span);

    if (context.parentSpanId) {
      const parentSpan = this.activeSpans.get(context.parentSpanId);
      this.currentContext = parentSpan ? {
        traceId: context.traceId,
        spanId: context.parentSpanId,
        parentSpanId: parentSpan.parentSpanId,
      } : undefined;
    } else {
      this.currentContext = undefined;
    }
  }

  getCurrentContext(): SpanContext | undefined {
    return this.currentContext;
  }

  getTrace(traceId: string): Span[] {
    // First try to get from active spans (has full tree with children)
    const activeSpans = this.getActiveTrace(traceId);
    if (activeSpans.length > 0) {
      return activeSpans;
    }
    // Fallback to storage
    return this.storage.findByTraceId(traceId);
  }

  /**
   * Get a specific span by its spanId
   */
  getSpanById(spanId: string): Span | undefined {
    // First check active spans
    const activeSpan = this.activeSpans.get(spanId);
    if (activeSpan) {
      return activeSpan;
    }
    // Fallback to storage - need to search through all traces
    const traces = this.storage.listTraces(1000);
    for (const trace of traces) {
      const spans = this.storage.findByTraceId(trace.traceId);
      for (const span of spans) {
        if (span.spanId === spanId) {
          return span;
        }
      }
    }
    return undefined;
  }
  
  private getActiveTrace(traceId: string): Span[] {
    // Get all spans for this trace from activeSpans
    const traceSpans: Span[] = [];
    for (const [spanId, span] of this.activeSpans) {
      if (span.traceId === traceId) {
        traceSpans.push(span);
      }
    }
    if (traceSpans.length === 0) return [];
    
    // Build tree from active spans
    return this.buildTreeFromSpans(traceSpans);
  }
  
  private buildTreeFromSpans(spans: Span[]): Span[] {
    // Spans from activeSpans already have children populated
    // Just need to find the roots (spans without parent in this trace)
    const spanIds = new Set(spans.map(s => s.spanId));
    const roots = spans.filter(span => !span.parentSpanId || !spanIds.has(span.parentSpanId));
    return roots;
  }

  getCurrentTrace(): Span[] {
    if (this.currentContext) {
      return this.getTrace(this.currentContext.traceId);
    }
    // If no active context, return empty (trace has ended)
    // Use getTrace(traceId) directly if you need to query ended traces
    return [];
  }

  listTraces(limit?: number): TraceInfo[] {
    return this.storage.listTraces(limit);
  }

  clearTrace(traceId: string): void {
    for (const [spanId, span] of this.activeSpans) {
      if (span.traceId === traceId) {
        this.activeSpans.delete(spanId);
      }
    }
    this.storage.deleteByTraceId(traceId);
  }

  exportTrace(traceId: string): string {
    const spans = this.getTrace(traceId);
    return JSON.stringify(spans, null, 2);
  }

  formatTrace(traceId: string): string {
    const spans = this.getTrace(traceId);
    if (spans.length === 0) {
      return "No trace found";
    }

    const lines: string[] = [];
    lines.push(`\nTrace: ${traceId}\n`);

    const formatSpan = (span: Span, indent: string = "") => {
      const duration = span.endTime ? span.endTime - span.startTime : 0;
      const statusIcon = span.status === SpanStatus.OK ? "✓" : "✗";
      const durationStr = `[${duration}ms]`;

      let line = `${indent}${statusIcon} ${span.name} ${durationStr}`;
      if (span.error) {
        line += ` - ${span.error}`;
      }
      lines.push(line);

      if (span.children) {
        for (const child of span.children) {
          formatSpan(child, indent + "  ");
        }
      }
    };

    for (const span of spans) {
      formatSpan(span);
    }

    return lines.join("\n");
  }

  /**
   * Format trace with spanId for detailed investigation
   * Use this to get spanId first, then use get_span_detail for specific span
   */
  formatTraceWithSpanId(traceId: string): string {
    const spans = this.getTrace(traceId);
    if (spans.length === 0) {
      return "No trace found";
    }

    const lines: string[] = [];
    lines.push(`\nTrace: ${traceId}`);
    lines.push(`\n💡 Tip: Use get_span_detail with spanId to get detailed info\n`);

    // Build a map of all spans (including children) for lookup
    const allSpanIds: string[] = [];
    const collectSpanIds = (span: Span) => {
      allSpanIds.push(span.spanId);
      if (span.children) {
        for (const child of span.children) {
          collectSpanIds(child);
        }
      }
    };
    for (const span of spans) {
      collectSpanIds(span);
    }

    const formatSpan = (span: Span, indent: string = "") => {
      const duration = span.endTime ? span.endTime - span.startTime : 0;
      const statusIcon = span.status === SpanStatus.OK ? "✓" : "✗";
      const durationStr = `[${duration}ms]`;
      const spanIdDisplay = span.spanId; // Show full spanId for get_span_detail lookup
      
      // Format timestamp to readable time
      const startTimeStr = new Date(span.startTime).toISOString().slice(11, 23); // HH:MM:SS.mmm
      const endTimeStr = span.endTime ? new Date(span.endTime).toISOString().slice(11, 23) : "ongoing";

      let line = `${indent}${statusIcon} ${span.name} ${durationStr} ${startTimeStr}→${endTimeStr} (spanId: ${spanIdDisplay})`;
      if (span.error) {
        line += ` - ${span.error}`;
      }
      lines.push(line);

      if (span.children) {
        for (const child of span.children) {
          formatSpan(child, indent + "  ");
        }
      }
    };

    for (const span of spans) {
      formatSpan(span);
    }

    // Add time range info at the top
    const firstSpan = spans[0];
    const lastSpan = spans[spans.length - 1];
    const overallStart = new Date(firstSpan.startTime).toISOString().slice(11, 23);
    const overallEnd = lastSpan.endTime ? new Date(lastSpan.endTime).toISOString().slice(11, 23) : "ongoing";
    lines.unshift(`📅 Time Range: ${overallStart} → ${overallEnd}`);
    lines.push(`\n📋 Total spans: ${allSpanIds.length}`);

    return lines.join("\n");
  }

  formatTraceTable(): string {
    const traces = this.listTraces(100);
    if (traces.length === 0) {
      return "No traces found";
    }

    const lines: string[] = [];
    lines.push("\nRecent Traces:\n");
    lines.push("  Trace ID                    | Root Span          | Duration | Spans | Status");
    lines.push("  " + "-".repeat(80));

    for (const trace of traces) {
      const traceIdShort = trace.traceId.slice(0, 26);
      const rootName = trace.rootSpanName.slice(0, 18);
      const duration = trace.duration ? `${trace.duration}ms` : "-";
      const spanCount = trace.spanCount.toString();
      const statusStr = trace.status;

      lines.push(`  ${traceIdShort.padEnd(26)} | ${rootName.padEnd(18)} | ${duration.padEnd(8)} | ${spanCount.padEnd(5)} | ${statusStr}`);
    }

    return lines.join("\n");
  }

  private generateTraceId(): string {
    return `trace_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private generateSpanId(): string {
    return `span_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }
}

let collector: SpanCollector | null = null;

export function setSpanCollector(c: SpanCollector): void {
  collector = c;
}

export function getSpanCollector(): SpanCollector | null {
  return collector;
}
