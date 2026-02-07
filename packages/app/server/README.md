# Agent Core Server

HTTP Server with SSE (Server-Sent Events) support for agent-core framework.

## Features

- ✅ HTTP API with Hono framework
- ✅ SSE endpoint for real-time event streaming
- ✅ EventBus integration
- ✅ Session filtering
- ✅ Heartbeat mechanism
- ✅ CORS support

## Quick Start

### 1. Install Dependencies

```bash
cd app/server
bun install
```

### 2. Configure Environment

Create `.env` file:

```bash
LLM_MODEL=openai/gpt-4o-mini
LLM_API_KEY=your-api-key
LLM_BASE_URL=https://api.openai.com/v1  # Optional
PORT=3000
```

### 3. Start Server (Using Start Script)

The start script automatically loads `.env` file and validates configuration:

```bash
# Start with .env configuration
bun run start

# Start in development mode (with hot reload)
bun run start:dev

# Start with custom port
bun run start --port 3001

# Or use the script directly
./start.ts
```

Output:
```
🚀 Agent Core Server Starter

✅ Loaded .env from .env

📋 Configuration:
   LLM_MODEL: openai/gpt-4o-mini
   LLM_BASE_URL: https://api.openai.com/v1
   PORT: 3000

🔄 Starting server...

╔════════════════════════════════════════════════════════════╗
║     Agent Core Server                                      ║
╚════════════════════════════════════════════════════════════╝

🔄 初始化 ServerEnvironment...
✅ Environment 已创建 (Model: openai/gpt-4o-mini)
   Tools: invoke_llm, system1_intuitive_reasoning

🚀 Server running at http://0.0.0.0:3000
📡 SSE endpoint: http://0.0.0.0:3000/events
❤️  Health check: http://0.0.0.0:3000/health
```

## API Endpoints

### Health Check

```bash
GET /health
```

Response:
```json
{
  "status": "ok",
  "timestamp": 1234567890,
  "version": "0.1.0"
}
```

### SSE Events

```bash
GET /events
GET /events?sessionId=<session-id>
```

Stream format:
```
data: {"type":"server.connected","timestamp":1234567890}

data: {"type":"stream.start","properties":{"sessionId":"abc","model":"gpt-4"}}

data: {"type":"stream.text","properties":{"sessionId":"abc","content":"Hello","delta":"Hello"}}

data: {"type":"stream.completed","properties":{"sessionId":"abc"}}

data: {"type":"server.heartbeat","timestamp":1234567920}
```

## Client Examples

### curl

```bash
# Subscribe to all events
curl -N http://localhost:3000/events

# Subscribe to specific session
curl -N "http://localhost:3000/events?sessionId=abc123"
```

### Browser (JavaScript)

```javascript
const eventSource = new EventSource('/events');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};

eventSource.onerror = (error) => {
  console.error('SSE error:', error);
};
```

### Node.js

```javascript
const EventSource = require('eventsource');

const eventSource = new EventSource('http://localhost:3000/events');

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};
```

## Event Types

### Server Events

- `server.connected` - Initial connection established
- `server.heartbeat` - Keep-alive ping (every 30s)
- `server.error` - Server error occurred

### Stream Events

- `stream.start` - LLM stream started
- `stream.text` - Text chunk received
- `stream.reasoning` - Reasoning content (if supported by model)
- `stream.tool.call` - Tool call initiated
- `stream.tool.result` - Tool execution result
- `stream.completed` - Stream completed
- `stream.error` - Stream error

### Session Events

- `session.created` - Session created
- `session.updated` - Session updated
- `session.deleted` - Session deleted

## Architecture

```
┌─────────────┐     GET /events      ┌─────────────┐
│   Client    │ ◄──────────────────  │    Server   │
│             │    SSE Connection    │             │
└─────────────┘                      └──────┬──────┘
                                            │
                                            │ subscribe
                                            ▼
                                      ┌─────────────┐
                                      │  EventBus   │
                                      └──────┬──────┘
                                            │
                                            │ publish
                                            ▼
                                      ┌─────────────┐
                                      │ ServerEnv   │
                                      │  (LLM)      │
                                      └─────────────┘
```

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `PORT` | HTTP server port | `3000` |
| `HOSTNAME` | Server hostname | `0.0.0.0` |
| `LLM_MODEL` | LLM model identifier | - |
| `LLM_API_KEY` | LLM API key | - |
| `LLM_BASE_URL` | LLM API base URL | - |

## Development

```bash
# Type check
bun run typecheck

# Build
bun run build

# Start (production)
bun run start
```

## Testing

```bash
# Start server
bun run src/index.ts

# In another terminal, test SSE
curl -N http://localhost:3000/events

# Test with session filter
curl -N "http://localhost:3000/events?sessionId=test123"
```

## References

- [SSE Design Document](../../docs/architecture/sse-design.md)
- [EventBus Design Document](../../docs/architecture/eventbus-design.md)
- [Hono Documentation](https://hono.dev/)
- [MDN Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
