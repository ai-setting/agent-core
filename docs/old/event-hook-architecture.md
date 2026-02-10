# Event Hook Architecture Design

## 1. Overview

This document describes the event hook architecture for Agent Core, which enables unified event streaming from LLM calls and tool executions. The architecture uses a hook mechanism that subclasses can implement to handle events for features like SSE broadcasting, logging, or analytics.

## 2. Architecture

### 2.1 Core Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                        │
│  (UI, CLI, Web API, etc.)                                │
└─────────────────────────┬───────────────────────────────────┘
                          │ SSE / WebSocket / Polling
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Environment Subclass (with Event Bus)           │
│  - Implements onStreamEvent() hook                         │
│  - Broadcasts events via SSE/WebSocket                     │
│  - Example: WebEnv, TuiEnv                                │
└─────────────────────────┬───────────────────────────────────┘
                          │ extends
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    BaseEnvironment                           │
│  - Implements handle_action(), handle_query()               │
│  - Emits events through onStreamEvent() hook               │
│  - Tool execution lifecycle management                      │
└─────────────────────────┬───────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   invoke_llm     │ │   get_weather   │ │   other tools   │
│   (LLM Events)  │ │   (Tool Events) │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### 2.2 Event Flow

```
User Query
    │
    ▼
┌─────────────────────────────┐
│  Environment.handle_query  │
└─────────────┬─────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Agent.run()                │
│  - Calls invoke_llm         │
└─────────────┬─────────────┘
              │
    ┌─────────┴─────────┐
    ▼                   ▼
┌───────────────┐  ┌───────────────┐
│ LLM Stream    │  │ Tool Execute  │
│ Events        │  │ Events        │
└───────┬───────┘  └───────┬───────┘
        │                  │
        └────────┬─────────┘
                 │
                 ▼
        ┌────────────────┐
        │ emitStreamEvent│
        │    (hook)      │
        └───────┬────────┘
                │
                ▼
        ┌────────────────┐
        │  Environment    │
        │  Subclass      │
        │  Implementation │
        └───────┬────────┘
                │
                ▼
        ┌────────────────┐
        │ SSE / WebSocket│
        │ Broadcasting   │
        └───────────────┘
```

## 3. Event Types

### 3.1 StreamEvent Interface

```typescript
export type StreamEventType = 
  | "text"        // LLM text output
  | "reasoning"   // LLM reasoning output
  | "tool_call"   // Tool execution started
  | "tool_result" // Tool execution completed
  | "completed"   // LLM stream completed
  | "error"       // Error occurred
  | "start";      // Stream started

export interface StreamEvent {
  type: StreamEventType;
  content?: string;           // Text or reasoning content
  tool_name?: string;        // Tool name for tool events
  tool_args?: Record<string, unknown>;  // Tool arguments
  tool_result?: unknown;     // Tool execution result
  metadata?: Record<string, unknown>;   // Additional metadata
}
```

### 3.2 Event Examples

```typescript
// LLM text output
{ type: "text", content: "Hello!" }

// LLM reasoning
{ type: "reasoning", content: "Let me think..." }

// Tool call started
{ type: "tool_call", tool_name: "get_weather", tool_args: { city: "Beijing" } }

// Tool result
{ type: "tool_result", tool_name: "get_weather", tool_result: "Sunny, 25°C" }

// Completed
{ type: "completed" }

// Error
{ type: "error", content: "Tool not found" }
```

## 4. Interface Definition

### 4.1 Environment Interface

```typescript
export interface Environment {
  handle_query(query: string, context: Context): Promise<string>;
  handle_action(action: Action, context: Context): Promise<ToolResult>;
  getTools(): Tool[];
  getPrompt(prompt_id: string): Prompt | undefined;
  subscribe(handler: StreamHandler): void;
  unsubscribe(handler: StreamHandler): void;
  getStream(stream_id: string): LLMStream | undefined;
  pushToSubscribers(event: LLMStreamEvent): void;
  sendResponse(content: string | Record<string, unknown>, context: Context): Promise<string>;
  
  /**
   * Optional hook for handling stream events.
   * Subclasses can implement this to broadcast events via SSE, WebSocket, etc.
   *
   * @param event - The stream event
   * @param context - The execution context
   */
  onStreamEvent?(event: StreamEvent, context: Context): void | Promise<void>;
}
```

## 5. Implementation

### 5.1 BaseEnvironment Implementation

```typescript
export abstract class BaseEnvironment implements Environment {
  // ... other methods ...

  /**
   * Emits a stream event through the hook if registered.
   */
  protected emitStreamEvent(event: StreamEvent, context: Context): void | Promise<void> {
    if (this.onStreamEvent) {
      this.onStreamEvent(event, context);
    }
  }

  async handle_action(action: Action, ctx: Context): Promise<ToolResult> {
    const tool = this.getTool(action.tool_name);
    
    // Emit tool call start event
    this.emitStreamEvent({
      type: "tool_call",
      tool_name: action.tool_name,
      tool_args: action.args,
    }, ctx);

    try {
      const result = await this.executeTool(tool, action, ctx);
      
      // Emit tool result event
      this.emitStreamEvent({
        type: "tool_result",
        tool_name: action.tool_name,
        tool_result: result.output,
        metadata: result.metadata,
      }, ctx);
      
      return result;
    } catch (error) {
      // Emit error event
      this.emitStreamEvent({
        type: "error",
        content: error instanceof Error ? error.message : String(error),
        tool_name: action.tool_name,
      }, ctx);
      throw error;
    }
  }
}
```

### 5.2 Subclass Implementation (WebEnv Example)

```typescript
export class WebEnv extends BaseEnvironment {
  private sseClients: Set<(event: StreamEvent) => void> = new Set();

  /**
   * Implements event broadcasting via SSE.
   */
  async onStreamEvent(event: StreamEvent, context: Context): Promise<void> {
    // Broadcast to all connected SSE clients
    for (const sendEvent of this.sseClients) {
      try {
        sendEvent(event);
      } catch (error) {
        console.error("Failed to send event to SSE client:", error);
      }
    }
  }

  /**
   * SSE endpoint handler.
   */
  async handleSSE(request: Request): Promise<Response> {
    const stream = new ReadableStream({
      start: (controller) => {
        const sendEvent = (event: StreamEvent) => {
          const data = JSON.stringify(event);
          controller.enqueue(`data: ${data}\n\n`);
        };
        
        this.sseClients.add(sendEvent);
        
        request.signal.addEventListener("abort", () => {
          this.sseClients.delete(sendEvent);
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }
}
```

## 6. Usage Examples

### 6.1 Basic Environment (No Event Bus)

```typescript
class CliEnv extends BaseEnvironment {
  // onStreamEvent not implemented - events are silently ignored
}

// Events are still collected internally but not broadcast
const env = new CliEnv();
await env.handle_query("Hello", context);
// Output: "Hello!"
```

### 6.2 Environment with SSE Broadcasting

```typescript
class WebEnv extends BaseEnvironment {
  private clients: Set<(event: StreamEvent) => void> = new Set();

  onStreamEvent(event: StreamEvent): void {
    for (const client of this.clients) {
      client(event);
    }
  }

  addClient(callback: (event: StreamEvent) => void): void {
    this.clients.add(callback);
    return () => this.clients.delete(callback);
  }
}

// Server setup
const env = new WebEnv();
const unsubscribe = env.addClient((event) => {
  console.log("Event:", event.type, event.content || event.tool_name);
});

// Client receives events in real-time
```

### 6.3 Environment with Logging

```typescript
class LoggingEnv extends BaseEnvironment {
  private eventLog: StreamEvent[] = [];

  async onStreamEvent(event: StreamEvent): Promise<void> {
    this.eventLog.push({
      ...event,
      timestamp: Date.now(),
    });
    
    // Also log to console
    console.log(`[${event.type}]`, 
      event.content || event.tool_name || "");
  }
}
```

## 7. Integration with LLM Events

### 7.1 LLM Stream Events

The `invoke_llm` tool collects LLM stream events internally:

```typescript
// invoke_llm tool collects these events:
- text chunks from LLM
- reasoning content from LLM
- tool_calls from LLM
- usage information
```

### 7.2 Unified Event Interface

Both LLM and tool events are normalized to `StreamEvent`:

```typescript
// LLM text output
{ type: "text", content: "Hello!" }

// LLM reasoning
{ type: "reasoning", content: "Let me think about this..." }

// LLM decided to call a tool
{ type: "tool_call", tool_name: "get_weather", tool_args: {...} }

// Tool result (executed by Agent)
{ type: "tool_result", tool_name: "get_weather", tool_result: "Sunny" }
```

## 8. Design Principles

### 8.1 Separation of Concerns

- **BaseEnvironment**: Core execution logic, hook invocation
- **Subclass**: Event handling, broadcasting, persistence
- **Agent**: Tool selection, reasoning, conversation management

### 8.2 Optional Hook

The `onStreamEvent` hook is optional:
- BaseEnvironment checks `if (this.onStreamEvent)` before calling
- Subclasses without event handling work correctly
- Events are not lost - they just aren't broadcast

### 8.3 Async Support

The hook supports both sync and async handlers:

```typescript
onStreamEvent?(event: StreamEvent, context: Context): void | Promise<void>;
```

This allows subclasses to:
- Perform synchronous logging
- Emit to WebSocket (sync)
- Write to database (async)
- Send to external service (async)

## 9. Future Enhancements

### 9.1 Event Filtering

```typescript
onStreamEvent?(event: StreamEvent, context: Context): void | Promise<void> {
  // Filter by event type
  if (event.type === "tool_result" && this.filterToolResults) {
    // ...
  }
}
```

### 9.2 Event Transformation

```typescript
onStreamEvent(event: StreamEvent): void {
  const transformed = {
    ...event,
    timestamp: Date.now(),
    session_id: context.session_id,
  };
  this.broadcast(transformed);
}
```

### 9.3 Event Persistence

```typescript
async onStreamEvent(event: StreamEvent): Promise<void> {
  await this.db.events.insert({
    ...event,
    session_id: context.session_id,
    timestamp: new Date(),
  });
}
```

## 10. Security Considerations

### 10.1 Sensitive Data

- Tools should not emit sensitive data in events
- Subclasses should sanitize events before broadcasting
- Consider filtering tool arguments in production

### 10.2 Event Validation

```typescript
onStreamEvent(event: StreamEvent): void {
  // Validate event structure
  if (!event.type || !validTypes.includes(event.type)) {
    console.warn("Invalid event type:", event.type);
    return;
  }
}
```

## 11. Related Files

- `src/environment/index.ts` - Environment interface
- `src/environment/base-environment.ts` - Base implementation
- `src/tools/invoke-llm.ts` - LLM tool implementation
- `src/agent/index.ts` - Agent with react loop
