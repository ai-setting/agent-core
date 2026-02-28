import { Span, SpanKind, SpanStatus } from "./span.js";
import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";
import { ConfigPaths } from "../config/paths.js";
import { createLogger } from "./logger.js";

const traceLogger = createLogger("trace:sqlite", "server.log");

export interface TraceInfo {
  traceId: string;
  rootSpanName: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  spanCount: number;
  status: "ok" | "error" | "mixed";
}

export interface SpanStorage {
  initialize(): Promise<void>;
  save(span: Span): void;
  saveBatch(spans: Span[]): void;
  findByTraceId(traceId: string): Span[];
  listTraces(limit?: number): TraceInfo[];
  deleteByTraceId(traceId: string): void;
  close(): void;
}

export class InMemorySpanStorage implements SpanStorage {
  private cache = new Map<string, Span[]>();
  private spanMap = new Map<string, Span>();

  async initialize(): Promise<void> {
    // No initialization needed for in-memory storage
  }

  save(span: Span): void {
    if (!this.cache.has(span.traceId)) {
      this.cache.set(span.traceId, []);
    }
    this.cache.get(span.traceId)!.push(span);
    this.spanMap.set(span.spanId, span);
  }

  saveBatch(spans: Span[]): void {
    for (const span of spans) {
      this.save(span);
    }
  }

  findByTraceId(traceId: string): Span[] {
    const cached = this.cache.get(traceId);
    if (cached && cached.length > 0) {
      return this.buildTree(cached);
    }
    return [];
  }

  listTraces(limit: number = 10): TraceInfo[] {
    const traces: TraceInfo[] = [];

    for (const [traceId, spans] of this.cache) {
      if (spans.length === 0) continue;

      const rootSpan = spans.find(s => !s.parentSpanId);
      const startTime = Math.min(...spans.map(s => s.startTime));
      const endTime = Math.max(...spans.map(s => s.endTime || s.startTime));
      const statuses = [...new Set(spans.map(s => s.status))];

      let status: "ok" | "error" | "mixed" = "ok";
      if (statuses.includes(SpanStatus.ERROR)) {
        status = statuses.length > 1 ? "mixed" : "error";
      }

      traces.push({
        traceId,
        rootSpanName: rootSpan?.name || "unknown",
        startTime,
        endTime,
        duration: endTime - startTime,
        spanCount: spans.length,
        status,
      });
    }

    return traces
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit);
  }

  deleteByTraceId(traceId: string): void {
    const spans = this.cache.get(traceId) || [];
    for (const span of spans) {
      this.spanMap.delete(span.spanId);
    }
    this.cache.delete(traceId);
  }

  close(): void {
    // No cleanup needed for in-memory storage
  }

  private buildTree(spans: Span[]): Span[] {
    const spanMap = new Map<string, Span>();
    const roots: Span[] = [];

    for (const span of spans) {
      spanMap.set(span.spanId, { ...span, children: [] });
    }

    for (const span of spanMap.values()) {
      if (span.parentSpanId) {
        const parent = spanMap.get(span.parentSpanId);
        if (parent) {
          parent.children!.push(span);
        } else {
          roots.push(span);
        }
      } else {
        roots.push(span);
      }
    }

    return roots;
  }
}

export class SQLiteSpanStorage implements SpanStorage {
  private db: Database | null = null;
  private dbPath: string;
  private initialized = false;

  private cache = new Map<string, Span[]>();
  private spanMap = new Map<string, Span>();

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? path.join(ConfigPaths.traces, "spans.db");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.run("PRAGMA journal_mode = WAL");
    await this.migrate();
    this.initialized = true;
    traceLogger.info(`SQLite span storage initialized at ${this.dbPath}`);
  }

  private async migrate(): Promise<void> {
    if (!this.db) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS span (
        span_id TEXT PRIMARY KEY,
        trace_id TEXT NOT NULL,
        parent_span_id TEXT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        attributes TEXT,
        result TEXT,
        error TEXT,
        time_created INTEGER NOT NULL
      )
    `);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_span_trace ON span(trace_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_span_parent ON span(parent_span_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_span_start_time ON span(start_time DESC)`);
  }

  save(span: Span): void {
    if (!this.cache.has(span.traceId)) {
      this.cache.set(span.traceId, []);
    }
    this.cache.get(span.traceId)!.push(span);
    this.spanMap.set(span.spanId, span);
    this.persistSpan(span);
  }

  saveBatch(spans: Span[]): void {
    if (!this.db || spans.length === 0) return;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO span 
      (span_id, trace_id, parent_span_id, name, kind, status, start_time, end_time, attributes, result, error, time_created)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = this.db.transaction((spans: Span[]) => {
      for (const span of spans) {
        stmt.run(
          span.spanId,
          span.traceId,
          span.parentSpanId ?? null,
          span.name,
          span.kind,
          span.status,
          span.startTime,
          span.endTime ?? null,
          JSON.stringify(span.attributes),
          span.result !== undefined ? JSON.stringify(span.result) : null,
          span.error ?? null,
          Date.now()
        );
      }
    });

    insertMany(spans);
  }

  private persistSpan(span: Span): void {
    this.saveBatch([span]);
  }

  findByTraceId(traceId: string): Span[] {
    const cached = this.cache.get(traceId);
    if (cached && cached.length > 0) {
      return this.buildTree(cached);
    }

    if (!this.db) return [];

    const stmt = this.db.prepare("SELECT * FROM span WHERE trace_id = ? ORDER BY start_time");
    const rows = stmt.all(traceId) as any[];

    const spans = rows.map(row => this.rowToSpan(row));
    return this.buildTree(spans);
  }

  listTraces(limit: number = 10): TraceInfo[] {
    if (!this.db) return [];

    const stmt = this.db.prepare(`
      SELECT 
        trace_id,
        MIN(start_time) as start_time,
        MAX(end_time) as end_time,
        COUNT(*) as span_count,
        GROUP_CONCAT(DISTINCT status) as statuses,
        (SELECT name FROM span WHERE trace_id = spans.trace_id AND parent_span_id IS NULL LIMIT 1) as root_name
      FROM span as spans
      GROUP BY trace_id
      ORDER BY start_time DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];

    return rows.map(row => {
      const statuses = row.statuses?.split(",") || [];
      let status: "ok" | "error" | "mixed" = "ok";
      if (statuses.includes("error")) {
        status = statuses.length > 1 ? "mixed" : "error";
      }

      return {
        traceId: row.trace_id,
        rootSpanName: row.root_name || "unknown",
        startTime: row.start_time,
        endTime: row.end_time,
        duration: row.end_time ? row.end_time - row.start_time : undefined,
        spanCount: row.span_count,
        status,
      };
    });
  }

  deleteByTraceId(traceId: string): void {
    const spans = this.cache.get(traceId) || [];
    for (const span of spans) {
      this.spanMap.delete(span.spanId);
    }
    this.cache.delete(traceId);

    if (this.db) {
      this.db.prepare("DELETE FROM span WHERE trace_id = ?").run(traceId);
    }
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  private rowToSpan(row: any): Span {
    return {
      spanId: row.span_id,
      traceId: row.trace_id,
      parentSpanId: row.parent_span_id,
      name: row.name,
      kind: row.kind as SpanKind,
      status: row.status as SpanStatus,
      startTime: row.start_time,
      endTime: row.end_time,
      attributes: JSON.parse(row.attributes || "{}"),
      result: row.result ? JSON.parse(row.result) : undefined,
      error: row.error,
    };
  }

  private buildTree(spans: Span[]): Span[] {
    const spanMap = new Map<string, Span>();
    const roots: Span[] = [];

    for (const span of spans) {
      spanMap.set(span.spanId, { ...span, children: [] });
    }

    for (const span of spanMap.values()) {
      if (span.parentSpanId) {
        const parent = spanMap.get(span.parentSpanId);
        if (parent) {
          parent.children!.push(span);
        } else {
          roots.push(span);
        }
      } else {
        roots.push(span);
      }
    }

    return roots;
  }
}
