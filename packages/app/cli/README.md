# tong_work CLI

Command-line interface for agent-core with SSE streaming support.

## Features

- ✅ Interactive chat mode
- ✅ Real-time SSE streaming
- ✅ Session management
- ✅ Multiple commands (serve, attach, run)
- ✅ Multi-platform binary builds

## Installation

### From Source

```bash
cd packages/app/cli
bun install
bun run build
```

### From Binary

Download from [Releases](https://github.com/ai-setting/agent-core/releases)

## Quick Start

### 1. Start Server

```bash
# Default port (4096)
tong_work serve

# Custom port and host
tong_work serve --port 8080 --host 0.0.0.0

# With authentication
tong_work serve --password secret
```

### 2. Attach to Server

```bash
# Attach to local server
tong_work attach http://localhost:4096

# Resume specific session
tong_work attach http://localhost:4096 --session <session-id>
```

### 3. Direct Run

```bash
# Run a task
tong_work run "请帮我创建一个 Hello World"

# Continue last session
tong_work run --continue
```

## Commands

| Command | Description |
|---------|-------------|
| `tong_work serve` | Start headless server |
| `tong_work attach <url>` | Attach to running server |
| `tong_work run [message]` | Run task directly |
| `tong_work version` | Show version |

## Usage

### Development Mode

```bash
# Run from source
bun run dev
```

### Build Binary

```bash
# Build for current platform
bun run build:single

# Build all platforms
bun run build:release
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TONG_WORK_PORT` | Default server port |
| `TONG_WORK_HOST` | Default server host |
| `TONG_WORK_PASSWORD` | Default password |

## Directory Structure

```
packages/app/cli/
├── bin/
│   └── tong_work           # CLI entry script
├── src/
│   ├── index.ts           # CLI entry point
│   ├── commands/         # Command implementations
│   │   ├── serve.ts
│   │   ├── attach.ts
│   │   ├── run.ts
│   │   └── version.ts
│   ├── tui.ts            # Terminal UI
│   └── direct-runner.ts  # Direct run mode
├── scripts/
│   └── build.ts          # Build script
└── package.json
```

## Build Targets

| Target | OS | Arch |
|--------|-----|------|
| tong_work-linux-x64 | Linux | x64 |
| tong_work-linux-arm64 | Linux | ARM64 |
| tong_work-linux-x64-musl | Linux | x64 (musl) |
| tong_work-darwin-arm64 | macOS | ARM64 |
| tong_work-darwin-x64 | macOS | x64 |
| tong_work-windows-x64 | Windows | x64 |

## References

- [CLI Build Plan](../../docs/CLI_BUILD_PLAN.md)
- [Binary Build Design](../../docs/BINARY_BUILD.md)
- [Architecture Overview](../../docs/ARCHITECTURE.md)
