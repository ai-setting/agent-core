# Environment Event Mechanism Design

## 1. Problem Statement

Currently, when an agent executes a tool (especially long-running background tasks), the agent can only wait synchronously for the result. After the task completes, there's no mechanism for the agent to perceive the environment changes and continue processing.

We need an event mechanism that:
- Allows Environment to emit various events that can be observed by agents
- Inserts these events into LLM call messages as context
- Enables agents to perceive environment changes more comprehensively and dynamically
- Supports async task completion, execution failures, user feedback, and other environment observations

## 2. Core Design

### 2.1 Event Flow

```
Event Sources (Tool / Env / User / LLM)
    ↓
EventBus.publish(event)
    ↓
Event Processing Entry (with Queue)
    ↓
Rule Matching (by eventType)
    ↓
┌─ user_query → env.handle_query
├─ session.* → log only
├─ background_task.completed → code + EventHandlerAgent
└─ * → EventHandlerAgent (fallback)
```

### 2.2 Data Flow & Module Diagram

This section illustrates the complete flow from user query to final response, including event production, publishing, handling, and agent processing.

#### 2.2.1 Complete Flow Diagram (User Query Scenario)

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (TUI / External API)                             │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ HTTP POST /sessions/:id/prompt
                                        │ { content: "帮我写一个排序算法" }
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          SESSION ROUTE (sessions.ts)                                │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │  app.post("/:id/prompt", async (c) => {                                    │   │
│  │    const event = {                                                          │   │
│  │      id: crypto.randomUUID(),          // 1. Generate unique event ID      │   │
│  │      type: "user_query",                                                  │   │
│  │      timestamp: Date.now(),                                                 │   │
│  │      metadata: { trigger_session_id: id, source: "user" },               │   │
│  │      payload: { sessionId: id, content: body.content }                   │   │
│  │    };                                                                       │   │
│  │    await env.publishEvent(event);        // 2. Publish to EventBus          │   │
│  │    return c.json({ success: true });                                       │   │
│  │  })                                                                         │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ env.publishEvent(event)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           EVENTBUS (bus.ts)                                        │
│                                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────────┐     │
│   │  async publish(event) {                                // Entry Point   │     │
│   │    if (seen.has(event.id)) return;      // Idempotency check           │     │
│   │    seen.add(event.id);                                                         │     │
│   │    queue.push(event);                  // Enqueue                       │     │
│   │    processQueue();                      // Process                      │     │
│   │  }                                                                          │     │
│   └─────────────────────────────────────────────────────────────────────────┘     │
│                                        │                                          │
│                                        ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────────────┐     │
│   │  async handleEvent(event) {                                              │     │
│   │    const rule = findMatchedRule(event.type);   // Rule matching         │     │
│   │    if (!rule) {                                                          │     │
│   │      console.warn("No rule matched");                                    │     │
│   │      return;                                                              │     │
│   │    }                                                                      │     │
│   │    if (rule.handler.type === "function") {                               │     │
│   │      await rule.handler.fn(event);    // Execute function handler       │     │
│   │    } else if (rule.handler.type === "agent") {                          │     │
│   │      await handleWithAgent(event, rule.handler); // Create agent        │     │
│   │    }                                                                      │     │
│   │  }                                                                          │     │
│   └─────────────────────────────────────────────────────────────────────────┘     │
│                                                                                     │
│   Rules (registered in ServerEnvironment):                                          │
│   ┌─────────────────────────────────────────────────────────────────────────┐     │
│   │  priority: 100  → user_query         → function handler                │     │
│   │  priority: 80   → background_task.*  → function + EventHandlerAgent   │     │
│   │  priority: 50   → session.*          → log only                      │     │
│   │  priority: 10   → * (fallback)       → EventHandlerAgent              │     │
│   └─────────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ For user_query: call function handler
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                       USER_QUERY HANDLER (function type)                            │
│                                                                                     │
│   async (event) => {                                                               │
│     const { sessionId, content } = event.payload;                                  │
│                                                                                     │
│     // 1. Get session                                                              │
│     const session = await env.getSession(sessionId);                               │
│                                                                                     │
│     // 2. Add user message to session                                             │
│     session.addUserMessage(content);                                              │
│                                                                                     │
│     // 3. Get history                                                              │
│     const history = session.toHistory();                                          │
│                                                                                     │
│     // 4. Call handle_query (LLM processing)                                       │
│     const response = await env.handle_query(content, { session_id: sessionId },   │
│                                                history);                           │
│                                                                                     │
│     // 5. Add assistant message to session                                        │
│     session.addAssistantMessage(response);                                        │
│   }                                                                                │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ env.handle_query(...)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                          HANDLE_QUERY (base-environment.ts)                       │
│                                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────────┐     │
│   │  async handle_query(query, context, history) {                         │     │
│   │    await ensureLLMInitialized();                                                     │     │
│   │                                                                                     │     │
│   │    // Build messages for LLM                                              │     │
│   │    const messages = buildMessages(query, history);                      │     │
│   │                                                                                     │     │
│   │    // Call LLM (with tools)                                              │     │
│   │    const result = await invokeLLM(messages, tools, context, options);    │     │
│   │                                                                                     │     │
│   │    // Handle tool calls if any                                           │     │
│   │    while (result.toolCalls?.length > 0) {                               │     │
│   │      const toolResults = await executeTools(result.toolCalls);           │     │
│   │      messages.push(...toolResults);                                      │     │
│   │      const result = await invokeLLM(messages, tools, context, options);  │     │
│   │    }                                                                      │     │
│   │                                                                                     │     │
│   │    return result.content;                                                 │     │
│   │  }                                                                          │     │
│   └─────────────────────────────────────────────────────────────────────────────┘     │
│                                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────────┐     │
│   │  Stream Events during LLM processing:                                   │     │
│   │    - emitStreamEvent({ type: "start", ... })                          │     │
│   │    - emitStreamEvent({ type: "text", content: "正在思考..." })        │     │
│   │    - emitStreamEvent({ type: "reasoning", content: "..." })            │     │
│   │    - emitStreamEvent({ type: "tool_call", ... })                      │     │
│   │    - ...                                                                 │     │
│   │    - emitStreamEvent({ type: "completed", content: "..." })            │     │
│   │                                                                         │     │
│   │  These events are also published to EventBus for SSE subscribers       │     │
│   └─────────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ Response + Session updated
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           SSE / CLIENT RESPONSE                                    │
│                                                                                     │
│   ┌──────────────────────┐     ┌──────────────────────────────────────────────┐   │
│   │ HTTP Response         │     │ SSE Events (for real-time updates)          │   │
│   │ { success: true,     │     │                                              │   │
│   │   sessionId: "xxx",  │     │  → stream.start                              │   │
│   │   message: "Processing│     │  → stream.text ("正在思考...")              │   │
│   │    started" }         │     │  → stream.reasoning                         │   │
│   └──────────────────────┘     │  → stream.tool_call                          │   │
│                                 │  → ...                                       │   │
│                                 │  → stream.completed                          │   │
│                                 └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

#### 2.2.2 Background Task Completion Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         TOOL EXECUTION (Background Task)                          │
│                                                                                     │
│   User calls taskTool → Creates async task → Task runs in background              │
│                                        │                                          │
│                                        │ Task completes                           │
│                                        ▼                                          │
│   Tool emits:                                                                       │
│   env.publishEvent({                                                                │
│     id: "task-123-uuid",                                                           │
│     type: "background_task.completed",                                             │
│     timestamp: 1234567890,                                                         │
│     metadata: {                                                                    │
│       trigger_session_id: "session-abc",                                           │
│       source: "tool"                                                               │
│     },                                                                             │
│     payload: { taskId: "task-123", result: { ... } }                             │
│   });                                                                              │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              EVENTBUS                                              │
│                                                                                     │
│   Rule: background_task.completed → priority: 80 → function handler               │
│                                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────────┐     │
│   │  async (event) => {                                                    │     │
│   │    // 1. Code-based logic (optional preprocessing)                     │     │
│   │    const { taskId, result } = event.payload;                          │     │
│   │    console.log(`Task ${taskId} completed`);                           │     │
│   │                                                                             │     │
│   │    // 2. Create EventHandlerAgent                                       │     │
│   │    const agent = new EventHandlerAgent(env, prompt);                    │     │
│   │                                                                             │     │
│   │    // 3. Process event                                                    │     │
│   │    await agent.handle(event);                                           │     │
│   │  }                                                                          │     │
│   └─────────────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ agent.handle(event)
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         EVENTHANDLERAGENT (Stateless)                              │
│                                                                                     │
│   ┌─────────────────────────────────────────────────────────────────────────┐     │
│   │  async handle(event) {                                                │     │
│   │    // 1. Find session by trigger_session_id                           │     │
│   │    const session = await env.getSession(event.metadata.trigger_...); │     │
│   │                                                                             │     │
│   │    // 2. Construct 3 fake messages                                     │     │
│   │    const msg1 = {                                                       │     │
│   │      role: "user",                                                      │     │
│   │      content: `Observed event: ${event.type}\nEvent ID: ${event.id}` │     │
│   │    };                                                                   │     │
│   │    const msg2 = {                                                       │     │
│   │      role: "assistant",                                                │     │
│   │      tool_calls: [{ name: "get_event_info", args: { event_ids: [...] } }]│   │
│   │    };                                                                   │     │
│   │    const msg3 = {                                                       │     │
│   │      role: "tool",                                                     │     │
│   │      content: JSON.stringify(event)                                    │     │
│   │    };                                                                   │     │
│   │                                                                             │     │
│   │    // 3. Insert into session history                                   │     │
│   │    session.addUserMessage(msg1.content);                                 │     │
│   │    session.addAssistantMessage(msg2.content);  // (empty, has tool)   │     │
│   │    session.addToolMessage(msg3.content, msg2.tool_calls[0].id);      │     │
│   │                                                                             │     │
│   │    // 4. Trigger handle_query                                           │     │
│   │    const history = session.toHistory();                                │     │
│   │    await env.handle_query(`Process event: ${event.type}`,              │     │
│   │                           { session_id: session.id },                  │     │
│   │                           history);                                      │     │
│   │  }                                                                          │   │
│   └─────────────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        │ handle_query triggers LLM
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                        LLM PROCESSING (Continue or Respond)                        │
│                                                                                     │
│   Agent receives the 3 messages, understands:                                     │
│   "A background task completed, here's the result. What should I do?"             │
│                                                                                     │
│   Agent decides:                                                                   │
│   - Option A: Continue execution (call more tools)                                │
│   - Option B: Respond to user with result                                         │
│   - Option C: Ask user for confirmation                                           │
│                                                                                     │
│   → Response added to session history                                             │
│   → SSE sends updates to client                                                   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

#### 2.2.3 Key Data Structures

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                    EnvEvent                                        │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  {                                                                                 │
│    id: "550e8400-e29b-41d4-a716-446655440000",  // UUID, idempotency              │
│    type: "user_query" | "background_task.completed" | ...,                        │
│    timestamp: 1700000000000,                                                      │
│    metadata: {                                                                     │
│      trigger_session_id: "session-abc",       // Link to session                │
│      trigger_agent_id?: "agent-123",                                               │
│      trigger_agent_name?: "task-handler",                                         │
│      env_name?: "os",                                                             │
│      source: "user" | "tool" | "env" | "llm",                                    │
│      [key: string]: unknown  // Extensible                                        │
│    },                                                                              │
│    payload: { ... }   // Event-specific data                                     │
│  }                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Fake Messages                                         │
├─────────────────────────────────────────────────────────────────────────────────────┤
│  Msg1 (user):                                                                       │
│    "Observed event: background_task.completed"                                     │
│    "Event ID: 550e8400-e29b-41d4-a716-446655440000"                               │
│    "Time: 2026-02-16T10:00:00.000Z"                                              │
│                                                                                     │
│  Msg2 (assistant):                                                                 │
│    tool_calls: [{ name: "get_event_info", arguments: { event_ids: [...] } }]     │
│                                                                                     │
│  Msg3 (tool):                                                                       │
│    { event_id, event_type, timestamp, metadata, payload }                         │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Event Definition

```typescript
// packages/core/src/core/types/event.ts

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
  id: string;                    // UUID, unique ID for idempotency
  type: string;                  // Event type
  timestamp: number;
  metadata: {
    trigger_session_id?: string;
    trigger_agent_id?: string;
    trigger_agent_name?: string;
    env_name?: string;
    source?: string;             // tool, env, user, system, llm
    [key: string]: unknown;      // Extensible
  };
  payload: T;
}
```

## 3. Implementation

### 3.1 EventBus Unified Entry

```typescript
// packages/core/src/server/eventbus/bus.ts

export interface EventHandler {
  type: "function";
  fn: (event: EnvEvent) => Promise<void>;
}

export interface AgentHandler {
  type: "agent";
  prompt: string;
  systemPrompt?: string;
}

export interface EventRule {
  eventType: string | string[];  // e.g., "user_query" or ["session.*"]
  handler: EventHandler | AgentHandler;
  options?: {
    enabled?: boolean;
    priority?: number;
  };
}

export class EventBus {
  private rules: EventRule[] = [];
  private queue: EnvEvent[] = [];
  private processing: boolean = false;

  async publish<T>(event: EnvEvent<T>): Promise<void> {
    // 1. Idempotency check (by event.id)
    // 2. Enqueue
    await this.enqueue(event);
    // 3. Process queue
    await this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      await this.handleEvent(event);
    }

    this.processing = false;
  }

  private async handleEvent<T>(event: EnvEvent<T>): Promise<void> {
    const matchedRule = this.findMatchedRule(event.type);
    
    if (!matchedRule) {
      console.warn(`[EventBus] No rule matched for event: ${event.type}`);
      return;
    }

    if (matchedRule.handler.type === "function") {
      await matchedRule.handler.fn(event);
    } else if (matchedRule.handler.type === "agent") {
      await this.handleWithAgent(event, matchedRule.handler);
    }
  }

  private async handleWithAgent<T>(event: EnvEvent<T>, handler: AgentHandler): Promise<void> {
    const agent = new EventHandlerAgent(this.env, handler.prompt, handler.systemPrompt);
    await agent.handle(event);
  }

  registerRule(rule: EventRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => (b.options?.priority ?? 0) - (a.options?.priority ?? 0));
  }
}
```

### 3.2 EventHandlerAgent

EventHandlerAgent is a stateless agent, created fresh for each event:

```typescript
// packages/core/src/core/agent/event-handler-agent.ts

export class EventHandlerAgent {
  constructor(
    private env: ServerEnvironment,
    private prompt: string,
    private systemPrompt?: string
  ) {}

  async handle<T>(event: EnvEvent<T>): Promise<void> {
    // 1. Find corresponding session
    const sessionId = event.metadata.trigger_session_id;
    if (!sessionId) {
      console.warn("[EventHandlerAgent] No trigger_session_id in event metadata");
      return;
    }

    const session = await this.env.getSession?.(sessionId);
    if (!session) {
      console.warn(`[EventHandlerAgent] Session not found: ${sessionId}`);
      return;
    }

    // 2. Construct 3 messages (fake messages)
    const messages: HistoryMessage[] = [
      {
        role: "user",
        content: [
          { type: "text" as const, text: `Observed event: ${event.type}` },
          { type: "text" as const, text: `Event ID: ${event.id}` },
          { type: "text" as const, text: `Time: ${new Date(event.timestamp).toISOString()}` }
        ]
      },
      {
        role: "assistant",
        content: "",
        tool_calls: [{
          id: `call_${event.id}`,
          type: "function" as const,
          name: "get_event_info",
          arguments: JSON.stringify({ event_ids: [event.id] })
        }]
      },
      {
        role: "tool",
        tool_call_id: `call_${event.id}`,
        content: JSON.stringify({
          event_id: event.id,
          event_type: event.type,
          timestamp: event.timestamp,
          metadata: event.metadata,
          payload: event.payload
        })
      }
    ];

    // 3. Insert into session history
    messages.forEach(msg => {
      if (msg.role === "user") session.addUserMessage(msg.content);
      else if (msg.role === "assistant") session.addAssistantMessage(msg.content);
    });

    // 4. Invoke handle_query to execute agent
    const history = session.toHistory();
    await this.env.handle_query(
      `Process event: ${event.type}`,
      { session_id: sessionId },
      history
    );
  }
}
```

### 3.3 ServerEnvironment Default Rules

```typescript
// packages/core/src/server/environment.ts

export class ServerEnvironment extends BaseEnvironment {
  private eventBus: EventBus;

  constructor(config: ServerEnvironmentConfig) {
    super(config);
    this.eventBus = new EventBus(this);
    this.initEventRules();
  }

  async publishEvent<T>(event: EnvEvent<T>): Promise<void> {
    await this.eventBus.publish(event);
  }

  private initEventRules(): void {
    const bus = this.eventBus;

    // Rule 1: user_query → env.handle_query
    bus.registerRule({
      eventType: EventTypes.USER_QUERY,
      handler: {
        type: "function",
        fn: async (event) => {
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

    // Rule 2: session.* → log only
    bus.registerRule({
      eventType: [EventTypes.SESSION_CREATED, EventTypes.SESSION_UPDATED, EventTypes.SESSION_DELETED],
      handler: {
        type: "function",
        fn: (event) => {
          console.log(`[EventBus] Session event: ${event.type}`, event);
        }
      },
      options: { priority: 50 }
    });

    // Rule 3: background_task.completed → code + EventHandlerAgent
    bus.registerRule({
      eventType: EventTypes.BACKGROUND_TASK_COMPLETED,
      handler: {
        type: "function",
        fn: async (event) => {
          const { taskId, result } = event.payload as { taskId: string; result: unknown };
          
          const agent = new EventHandlerAgent(
            this,
            "You are a background task expert. Analyze task results and decide how to handle."
          );
          await agent.handle(event);
        }
      },
      options: { priority: 80 }
    });

    // Rule 4: other events → EventHandlerAgent (fallback)
    bus.registerRule({
      eventType: "*",
      handler: {
        type: "agent",
        prompt: `You are an event handling expert. Analyze event content and decide: 1) respond to user; 2) continue execution; 3) interact with user for confirmation.`
      },
      options: { priority: 10 }
    });
  }
}
```

### 3.4 Session Route Transformation

```typescript
// packages/core/src/server/routes/sessions.ts

// POST /sessions/:id/prompt
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

### 3.5 StreamEvent Integration

In `invoke-llm.ts`:

```typescript
// Existing emitStreamEvent logic remains unchanged
// Also publish via EventBus (for other subscribers)

if (this.eventBus) {
  this.eventBus.publish({
    id: crypto.randomUUID(),
    type: `stream.${streamEvent.type}`,
    timestamp: Date.now(),
    metadata: {
      trigger_session_id: ctx.session_id,
      source: "llm"
    },
    payload: streamEvent
  });
}
```

## 4. File Changes

| File | Change |
|------|--------|
| `core/types/event.ts` | Add `EnvEvent` type + `EventTypes` constants |
| `server/eventbus/bus.ts` | Transform to unified entry + rule routing + queue + handler support |
| `server/environment.ts` | Register default rules + expose `publishEvent` |
| `server/routes/sessions.ts` | Transform `/prompt` route to only produce events |
| `core/agent/event-handler-agent.ts` | New EventHandlerAgent class |
| `core/environment/base/invoke-llm.ts` | Publish StreamEvent via EventBus |

## 5. Use Cases

### 5.1 Background Task Completion

1. User calls taskTool to create a background task
2. Tool executes asynchronously, completes
3. Tool emits `background_task.completed` event
4. EventBus matches rule, triggers EventHandlerAgent
5. Agent receives 3 fake messages in session context
6. Agent analyzes task result, decides to continue or interact with user

### 5.2 Environment Change Observation

1. Environment detects file change / external webhook / other trigger
2. Emits corresponding event (e.g., `file.changed`, `webhook.received`)
3. EventBus routes to EventHandlerAgent
4. Agent perceives change and can take appropriate action

### 5.3 Tool Execution Error

1. Tool execution fails
2. Tool emits `tool.error` event
3. EventHandlerAgent receives event
4. Agent can attempt recovery, fallback, or notify user

## 6. Future Enhancements

- **Rule configuration via file**: Support loading rules from config file
- **Event persistence**: Persist events for replay/debugging
- **Distributed EventBus**: Support multiple server instances
- **Event filtering/debouncing**: Prevent rapid-fire events from overwhelming the system

## 7. Unit Test Points

### 7.1 EventBus Tests

| Test Case | Description | Expected Behavior |
|-----------|-------------|-------------------|
| `publish_success` | Publish a valid event | Event is enqueued and processed |
| `publish_idempotency` | Publish same event ID twice | Second publish is ignored |
| `publish_unknown_type` | Publish event with no matching rule | Warning logged, no error |
| `rule_matching_exact` | Match event type exactly | Correct rule is selected |
| `rule_matching_array` | Match event type in array | Correct rule is selected |
| `rule_matching_wildcard` | Match wildcard `*` rule | Fallback rule is selected |
| `rule_priority` | Multiple rules match | Highest priority rule is selected |
| `function_handler` | Event triggers function handler | Handler function is called with event |
| `agent_handler` | Event triggers agent handler | EventHandlerAgent is created and handle is called |
| `queue_processing` | Publish multiple events rapidly | Events are processed sequentially |
| `queue_prevents_concurrent` | Publish while processing | Concurrent processing is prevented |

### 7.2 EventHandlerAgent Tests

| Test Case | Description | Expected Behavior |
|-----------|-------------|-------------------|
| `handle_no_session_id` | Event without trigger_session_id | Warning logged, no error |
| `handle_session_not_found` | Session doesn't exist | Warning logged, no error |
| `handle_constructs_messages` | Verify 3 messages are constructed | Correct user/assistant/tool messages created |
| `handle_message_content` | Verify message content includes event info | Contains type, ID, timestamp |
| `handle_inserts_to_session` | Messages are added to session history | Session messages increased by 3 |
| `handle_calls_handle_query` | handle_query is invoked with correct params | Called with sessionId and history |

### 7.3 ServerEnvironment Integration Tests

| Test Case | Description | Expected Behavior |
|-----------|-------------|-------------------|
| `publishEvent_basic` | Call publishEvent with valid event | Event is published to EventBus |
| `initEventRules_registers` | Verify default rules are registered | All 4 default rules exist |
| `user_query_rule_handles` | user_query event triggers handler | Session gets messages, handle_query called |
| `session_rule_logs` | session.* events are logged | console.log is called |
| `background_task_rule_creates_agent` | background_task.completed triggers agent | EventHandlerAgent.handle is called |
| `fallback_rule_matches` | Unknown event type matches fallback | EventHandlerAgent.handle is called |

### 7.4 Session Route Tests

| Test Case | Description | Expected Behavior |
|-----------|-------------|-------------------|
| `prompt_route_creates_event` | POST /:id/prompt creates event | Event with type user_query is published |
| `prompt_route_includes_payload` | Event payload contains sessionId and content | Correct payload in event |
| `prompt_route_includes_metadata` | Event metadata includes trigger_session_id | Correct metadata in event |
| `prompt_route_returns_success` | Route returns success response | HTTP 200 with sessionId |
| `prompt_route_missing_content` | Request without content | HTTP 400 error |
| `prompt_route_no_session_support` | Env has no session support | HTTP 503 error |

### 7.5 StreamEvent Integration Tests

| Test Case | Description | Expected Behavior |
|-----------|-------------|-------------------|
| `stream_event_published` | LLM emits stream event | EventBus.publish is called with stream.* type |
| `stream_event_metadata` | Verify stream event metadata | Contains trigger_session_id and source: "llm" |
| `existing_emit_unchanged` | Existing emitStreamEvent still works | SSE subscribers receive events as before |

## 8. Acceptance Criteria

### 8.1 Core Functionality

- [ ] **Event Definition**: `EnvEvent` type and `EventTypes` constants are defined in `core/types/event.ts`
- [ ] **EventBus Enhancement**: EventBus supports rule-based routing with function and agent handlers
- [ ] **Queue Mechanism**: EventBus processes events sequentially with idempotency check
- [ ] **publishEvent API**: ServerEnvironment exposes `publishEvent` method

### 8.2 Event Processing

- [ ] **user_query Processing**: POST /sessions/:id/prompt produces user_query event, which triggers handle_query execution
- [ ] **Session Events**: session.created/updated/deleted events are published and logged
- [ ] **background_task Processing**: background_task.completed event triggers EventHandlerAgent
- [ ] **Fallback Handler**: Unknown event types trigger EventHandlerAgent

### 8.3 EventHandlerAgent

- [ ] **Stateless Creation**: EventHandlerAgent is created fresh for each event
- [ ] **Message Construction**: 3 messages (user, assistant with tool_call, tool) are constructed correctly
- [ ] **Session Integration**: Messages are inserted into session history
- [ ] **handle_query Trigger**: Agent processing triggers handle_query execution

### 8.4 Integration Points

- [ ] **Session Route Transformation**: /prompt route only produces event, doesn't call handle_query directly
- [ ] **StreamEvent Publication**: Stream events are also published to EventBus (for SSE subscribers)
- [ ] **Existing SSE Flow**: Original SSE flow remains unchanged (backward compatible)

### 8.5 End-to-End Scenarios

- [ ] **User Query E2E**: User sends query → event published → handler processes → response returned → SSE updates client
- [ ] **Background Task E2E**: Task completes → event published → agent receives messages → agent decides action → user notified
- [ ] **Error Handling E2E**: Invalid event → no matching rule → warning logged → system remains stable

### 8.6 Performance & Stability

- [ ] **Concurrent Events**: Multiple rapid event publishes are handled without errors
- [ ] **Idempotency**: Duplicate event IDs are properly handled
- [ ] **Error Recovery**: Handler errors don't crash EventBus processing

---

> Design Document Version: 1.0  
> Last Updated: 2026-02-16
