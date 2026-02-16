# Environment Event Mechanism Implementation

This document describes the implementation details of the Environment Event Mechanism, corresponding to the design document `docs/environment-event-mechanism.md`.

## 1. Overview

The implementation adds a unified event processing system to the agent-core that allows:
- Environment events to trigger agent processing
- Async task completion to notify agents via event insertion
- Rule-based event routing to different handlers (function or agent)

## 2. Core Implementation

### 2.1 Event Type Definition

**File**: `packages/core/src/core/types/event.ts`

```typescript
export const EventTypes = {
  USER_QUERY: "user_query",
  SESSION_CREATED: "session.created",
  SESSION_UPDATED: "session.updated",
  SESSION_DELETED: "session.deleted",
  BACKGROUND_TASK_COMPLETED: "background_task.completed",
  BACKGROUND_TASK_FAILED: "background_task.failed",
  TOOL_EXECUTED: "tool.executed",
  TOOL_ERROR: "tool.error",
  STREAM_START: "stream.start",
  STREAM_TEXT: "stream.text",
  STREAM_COMPLETED: "stream.completed",
  STREAM_ERROR: "stream.error",
} as const;

export interface EnvEvent<T = unknown> {
  id: string;
  type: string;
  timestamp: number;
  metadata: {
    trigger_session_id?: string;
    trigger_agent_id?: string;
    trigger_agent_name?: string;
    env_name?: string;
    source?: string;
    [key: string]: unknown;
  };
  payload: T;
}
```

### 2.2 EnvEventBus Implementation

**File**: `packages/core/src/server/eventbus/bus.ts`

The `EnvEventBus` class provides unified event processing with:

- **Idempotency**: Duplicate events (same ID) are ignored
- **Queue mechanism**: Events are processed sequentially
- **Rule-based routing**: Events are routed to matching handlers based on event type
- **Priority support**: Higher priority rules are matched first

Key classes and interfaces:

```typescript
export interface EnvEventHandler {
  type: "function";
  fn: (event: EnvEvent) => Promise<void>;
}

export interface EnvAgentHandler {
  type: "agent";
  prompt: string;
  systemPrompt?: string;
}

export interface EnvEventRule {
  eventType: string | string[];
  handler: EnvEventHandler | EnvAgentHandler;
  options?: {
    enabled?: boolean;
    priority?: number;
  };
}

export class EnvEventBus {
  private rules: EnvEventRule[] = [];
  private queue: EnvEvent[] = [];
  private processing: boolean = false;
  private seen: Set<string> = new Set();
  private env: any;

  async publish<T>(event: EnvEvent<T>): Promise<void> {
    // 1. Idempotency check
    if (this.seen.has(event.id)) {
      console.warn(`[EnvEventBus] Duplicate event ignored: ${event.id}`);
      return;
    }
    this.seen.add(event.id);
    
    // 2. Enqueue
    this.queue.push(event as EnvEvent);
    
    // 3. Process
    await this.processQueue();
  }

  private async handleEvent<T>(event: EnvEvent<T>): Promise<void> {
    const matchedRule = this.findMatchedRule(event.type);
    if (!matchedRule) {
      console.warn(`[EnvEventBus] No rule matched for event: ${event.type}`);
      return;
    }

    if (matchedRule.options?.enabled !== false) {
      if (matchedRule.handler.type === "function") {
        await matchedRule.handler.fn(event);
      } else if (matchedRule.handler.type === "agent") {
        await this.handleWithAgent(event, matchedRule.handler);
      }
    }
  }

  registerRule(rule: EnvEventRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => (b.options?.priority ?? 0) - (a.options?.priority ?? 0));
  }
}
```

### 2.3 Event Processor Utility

**File**: `packages/core/src/core/event-processor.ts`

The `processEventInSession` function provides a generic way to process events in a session context:

1. Gets the session from `trigger_session_id` in event metadata
2. Constructs 3 messages (user, assistant with tool call, tool result)
3. Inserts messages into session history
4. Continues execution by calling `handle_query` with updated history

```typescript
export interface EventProcessorEnv {
  getSession?: (id: string) => SessionLike | undefined;
  handle_query: (query: string, ctx: any, history: any[]) => Promise<string>;
}

export interface EventProcessorOptions {
  prompt?: string;
  includeToolCall?: boolean;
  toolName?: string;
}

export async function processEventInSession<T>(
  env: EventProcessorEnv,
  event: EnvEvent<T>,
  options: EventProcessorOptions = {}
): Promise<void> {
  const sessionId = event.metadata.trigger_session_id;
  if (!sessionId) return;

  const session = env.getSession?.(sessionId);
  if (!session) return;

  const messages = constructEventMessages(event, options);
  messages.forEach((msg) => {
    if (msg.role === "user") {
      session.addUserMessage(msg.content as string);
    } else if (msg.role === "assistant") {
      session.addAssistantMessage(msg.content as string);
    }
  });

  const history = session.toHistory();
  const query = options.prompt || `Process event: ${event.type}`;
  await env.handle_query(query, { session_id: sessionId }, history);
}
```

### 2.4 ServerEnvironment Integration

**File**: `packages/core/src/server/environment.ts`

The `ServerEnvironment` class:

1. Creates an `EnvEventBus` instance
2. Registers default rules in `initEventRules()`
3. Exposes `publishEvent` method

```typescript
export class ServerEnvironment extends BaseEnvironment {
  private eventBus: EnvEventBus;

  constructor(config?: ServerEnvironmentConfig) {
    super(envConfig);
    this.eventBus = new EnvEventBus(this);
    this.initEventRules();
  }

  async publishEvent<T>(event: EnvEvent<T>): Promise<void> {
    await this.eventBus.publish(event);
  }

  private initEventRules(): void {
    const bus = this.eventBus;

    // Rule 1: user_query → env.handle_query (priority: 100)
    bus.registerRule({
      eventType: EventTypes.USER_QUERY,
      handler: {
        type: "function",
        fn: async (event: EnvEvent) => {
          const { sessionId, content } = event.payload as { sessionId: string; content: string };
          const session = await this.getSession!(sessionId);
          const history = session?.toHistory() || [];
          
          session?.addUserMessage(content);
          const response = await this.handle_query(content, { session_id: sessionId }, history);
          session?.addAssistantMessage(response);
        }
      },
      options: { priority: 100 }
    });

    // Rule 2: session.* → log only (priority: 50)
    bus.registerRule({
      eventType: [EventTypes.SESSION_CREATED, EventTypes.SESSION_UPDATED, EventTypes.SESSION_DELETED],
      handler: {
        type: "function",
        fn: (event: EnvEvent): Promise<void> => {
          console.log(`[EventBus] Session event: ${event.type}`, event);
          return Promise.resolve();
        }
      },
      options: { priority: 50 }
    });

    // Rule 3: background_task.completed → processEventInSession (priority: 80)
    bus.registerRule({
      eventType: EventTypes.BACKGROUND_TASK_COMPLETED,
      handler: {
        type: "function",
        fn: async (event: EnvEvent) => {
          const { processEventInSession } = await import("../core/event-processor.js");
          await processEventInSession(this, event, {
            prompt: "You are a background task expert. Analyze task results and decide how to handle.",
          });
        }
      },
      options: { priority: 80 }
    });

    // Rule 4: fallback → EventHandlerAgent (priority: 10)
    bus.registerRule({
      eventType: "*",
      handler: {
        type: "agent",
        prompt: `You are an event handling expert...`
      },
      options: { priority: 10 }
    });
  }
}
```

### 2.5 Session Route Transformation

**File**: `packages/core/src/server/routes/sessions.ts`

The `/sessions/:id/prompt` route now produces a `user_query` event instead of directly calling `handle_query`:

```typescript
app.post("/:id/prompt", async (c) => {
  const env = await ensureSessionEnv(c);
  if (!env) return c.json({ error: "Session support not available" }, 503);

  const id = c.req.param("id");
  const body = await c.req.json<{ content: string }>();

  if (!body?.content) {
    return c.json({ error: "Content is required" }, 400);
  }

  // Produce user_query event, let EventBus handle it
  const event: EnvEvent<{ sessionId: string; content: string }> = {
    id: crypto.randomUUID(),
    type: EventTypes.USER_QUERY,
    timestamp: Date.now(),
    metadata: {
      trigger_session_id: id,
      source: "user"
    },
    payload: {
      sessionId: id,
      content: body.content
    }
  };

  await env.publishEvent(event);

  return c.json({
    success: true,
    sessionId: id,
    message: "Processing started",
  });
});
```

## 3. Data Flow

### 3.1 User Query Flow

```
Client → POST /sessions/:id/prompt → user_query event → EventBus → 
  → USER_QUERY rule (priority 100) → handle_query → LLM → Response
```

### 3.2 Background Task Completion Flow

```
Tool → background_task.completed event → EventBus → 
  → BACKGROUND_TASK rule (priority 80) → processEventInSession → 
  → 3 messages → handle_query → Agent decision
```

## 4. Test Files

| Test File | Description |
|-----------|-------------|
| `packages/core/src/server/eventbus/env-event-bus.test.ts` | EnvEventBus unit tests (13 tests) |
| `packages/core/src/core/event-processor.test.ts` | EventProcessor utility tests |

## 5. File Summary

| File | Purpose |
|------|---------|
| `packages/core/src/core/types/event.ts` | Event type definitions and constants |
| `packages/core/src/server/eventbus/bus.ts` | EnvEventBus class implementation |
| `packages/core/src/core/event-processor.ts` | Event processor utility function |
| `packages/core/src/server/environment.ts` | ServerEnvironment integration |
| `packages/core/src/server/routes/sessions.ts` | Session route transformation |
| `packages/core/src/server/eventbus/env-event-bus.test.ts` | EnvEventBus tests |
| `packages/core/src/core/event-processor.test.ts` | EventProcessor tests |
| `docs/environment-event-mechanism.md` | Design document |
| `docs/DEVELOPMENT_PROGRESS.md` | Progress tracking |

## 6. How to Trigger Events

### 6.1 From Client

Send a prompt to the session:

```bash
curl -X POST http://localhost:3000/sessions/my-session/prompt \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello, help me write a sorting algorithm"}'
```

### 6.2 From Tool

Emit a background task completion event:

```typescript
await env.publishEvent({
  id: crypto.randomUUID(),
  type: "background_task.completed",
  timestamp: Date.now(),
  metadata: {
    trigger_session_id: sessionId,
    source: "tool"
  },
  payload: {
    taskId: "task-123",
    result: { success: true, data: "..." }
  }
});
```

### 6.3 From Environment

Emit any custom event:

```typescript
await env.publishEvent({
  id: crypto.randomUUID(),
  type: "file.changed",
  timestamp: Date.now(),
  metadata: {
    trigger_session_id: sessionId,
    source: "env"
  },
  payload: {
    filePath: "/path/to/file",
    changeType: "modified"
  }
});
```

## 7. Key Design Decisions

1. **Stateless Agent**: Each `EventHandlerAgent` is created fresh for each event to avoid state pollution.

2. **Idempotency**: Events with the same ID are ignored to prevent duplicate processing.

3. **Queue Processing**: Events are processed sequentially to avoid race conditions.

4. **Rule Priority**: Higher priority rules are matched first. Exact match takes precedence over wildcard.

5. **Function Handler**: For simple event handling (like logging or direct processing).
6. **Agent Handler**: For complex event handling requiring AI decision-making.
