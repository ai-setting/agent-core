# Agent CLI

Command-line interface for agent-core with SSE streaming support.

## Features

- ✅ Interactive chat mode
- ✅ Real-time SSE streaming
- ✅ Session management
- ✅ Auto-reconnect
- ✅ Simple commands (clear, exit, help)

## Usage

### Prerequisites

Start the Server first:

```bash
cd app/server
bun run start
```

### Run CLI (Using Start Script)

```bash
cd app/cli

# Connect to default server (localhost:3000)
bun run start

# Connect to different server with custom port
bun run start --server localhost:3001

# Connect to remote server
bun run start --server http://192.168.1.100:3000

# Resume specific session
bun run start --session abc123

# Or use the script directly
./start.ts
```

### Environment Variables

```bash
export AGENT_SERVER_URL=http://localhost:3000
bun run src/index.ts
```

## Interactive Commands

Once in interactive mode:

| Command | Description |
|---------|-------------|
| `<query>` | Send message to AI |
| `clear` | Clear screen |
| `help` | Show help |
| `exit` / `quit` | Exit program |

## Example Session

### Default Server (localhost:3000)

```
$ bun run start

🚀 Agent CLI Client Starter

🔍 Checking server at http://localhost:3000...
✅ Server is running (version: 0.1.0)

╔════════════════════════════════════════════╗
║         🤖 Agent CLI                       ║
╚════════════════════════════════════════════╝
Server: http://localhost:3000
Session: cli_1234567890_abc123
输入 'exit' 或 'quit' 退出

💬 你好
🤖 你好！很高兴见到你。有什么我可以帮助你的吗？

💬 请介绍一下自己
🤖 我是一个 AI 助手，可以帮助你解答问题、编写代码、分析文件等。

💬 exit
👋 再见!
```

### Custom Server Address

```bash
# Different port on localhost
bun run start --server localhost:3001

# Remote server with port
bun run start --server 192.168.1.100:3000

# Full URL with protocol
bun run start --server https://remote.server.com
```

## Architecture

```
┌──────────┐      SSE       ┌──────────┐
│   CLI    │ ◄──────────────► │  Server  │
│  Client  │   text/event   │          │
└──────────┘                └──────────┘
```

## Files

```
src/
├── index.ts         # Entry point
├── cli-engine.ts    # Interactive engine
└── client.ts        # SSE client
```

## Dependencies

- `eventsource` - SSE client
- `chalk` - Terminal colors

## Future Enhancements

- [ ] Subcommands (run, session, config)
- [ ] TUI mode (@opentui/solid)
- [ ] File references (@filename)
- [ ] Shell commands (!command)

## Configuration

### Command Line Arguments

| Argument | Description | Example |
|----------|-------------|---------|
| `--server <address>` | Server address (host:port or full URL) | `localhost:3001`, `http://192.168.1.100:3000` |
| `--session <id>` | Resume specific session | `abc123` |

### Environment Variables

Create `.env` file (optional):

```bash
# Server URL
AGENT_SERVER_URL=http://localhost:3000
```

Or set directly:

```bash
export AGENT_SERVER_URL=http://localhost:3001
bun run start
```

### Server Address Formats

The `--server` argument supports multiple formats:

```bash
# Just port (uses localhost)
--server :3001

# Host and port
--server localhost:3001
--server 192.168.1.100:3000

# With protocol
--server http://localhost:3000
--server https://remote.server.com
```

## References

- [CLI Design](../../docs/app/cli-design.md)
- [SSE Design](../../docs/architecture/sse-design.md)
- [Server Design](../../docs/app/server-design.md)
