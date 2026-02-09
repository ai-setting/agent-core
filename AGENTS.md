# Agent Core Development Guide

## 1. Overview

Agent Core is a lightweight AI Agent framework for operating system environments. This guide outlines the development standards, coding conventions, and best practices for contributing to this project.

### 1.1 Architecture Overview

```
agent-core/
├── packages/core/       ← Core framework with CLI and Server
│   ├── src/
│   │   ├── core/       ← Core framework (Agent, Session, Tool, Environment)
│   │   ├── cli/        ← CLI (tong_work binary)
│   │   └── server/     ← HTTP Server
│   └── bin/            ← Binary entry point
├── packages/app/       ← Application packages
│   ├── web/           ← Web Application (depends on core server)
│   └── desktop/       ← Desktop Application (depends on core server)
└── docs/              ← Documentation
```

### 1.2 Documentation

All design documentation is centralized in the `docs/` folder. **Before implementing any feature, read the relevant design documents first.**

#### Documentation Structure

```
docs/
├── ARCHITECTURE.md           ← Overall architecture (START HERE)
├── CLI_BUILD_PLAN.md        ← CLI build plan & design
├── OPENCODE_BUILD_SYSTEM.md ← OpenCode reference research
├── BINARY_BUILD.md          ← Binary build design
├── LLM_PROVIDER_ARCHITECTURE.md ← LLM provider integration
└── *.md                     ← Other design docs
```

#### Quick Reference

| Scenario | Document |
|----------|----------|
| Understand overall architecture | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| Build CLI binary | [docs/CLI_BUILD_PLAN.md](./docs/CLI_BUILD_PLAN.md) |
| Build multi-platform | [docs/BINARY_BUILD.md](./docs/BINARY_BUILD.md) |
| Add LLM provider | [docs/LLM_PROVIDER_ARCHITECTURE.md](./docs/LLM_PROVIDER_ARCHITECTURE.md) |
| Understand events | Event docs in docs/ |

#### Package Documentation

| Package | README |
|---------|--------|
| Core | [packages/core/README.md](./packages/core/README.md) |

## 2. Code Style Guidelines

### 2.1 TypeScript Conventions

- Use **TypeScript** for all source code
- Enable `strict` mode in `tsconfig.json`
- Prefer interfaces over type aliases for object schemas
- Use `readonly` for immutable properties
- Avoid `any` type; use `unknown` when type is uncertain

### 2.2 Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Classes | PascalCase | `BaseEnv`, `TimeoutManager` |
| Interfaces | PascalCase | `ToolInfo`, `LLMStreamEvent` |
| Types | PascalCase | `RecoveryAction` |
| Functions | camelCase | `executeWithTimeout` |
| Constants | SCREAMING_SNAKE_CASE | `DEFAULT_TIMEOUT_MS` |
| Variables | camelCase | `maxRetries` |
| Private members | camelCase with `_` prefix | `_activeSlots` |

### 2.3 File Organization

#### Monorepo Structure

```
agent-core/
├── packages/core/          # Core framework with CLI and Server
│   └── src/
│       ├── types/         # Type definitions
│       ├── tool/          # Tool framework
│       ├── environment/   # Environment abstractions
│       ├── agent/         # Agent logic
│       ├── llm/           # LLM adapters
│       ├── session/       # Session management
│       ├── cli/           # CLI implementation
│       └── server/        # HTTP Server
├── packages/app/          # Applications
│   ├── web/            ← depends on packages/core server
│   └── desktop/         ← depends on packages/core server
└── docs/                # Documentation
```

#### Core Package (`packages/core/src/`)

```
packages/core/src/
├── types/           # Type definitions (interfaces, types)
├── tool/           # Tool framework
├── environment/    # Environment abstractions
│   └── base/       # Base implementations
├── agent/          # Agent logic
├── llm/            # LLM adapters
├── session/        # Session management
├── cli/            # CLI implementation
│   ├── index.ts   # CLI entry point
│   ├── commands/  # Command implementations
│   ├── client.ts  # HTTP client for server
│   ├── tui.ts     # Terminal UI
│   └── direct-runner.ts
└── server/         # HTTP Server
    ├── index.ts   # Server entry point
    ├── server.ts  # Hono server
    ├── environment.ts  # Server environment
    ├── session.ts      # Session management
    ├── routes/         # API routes
    └── eventbus/       # Event bus
```

### 2.4 Export Guidelines

- Use named exports for types, interfaces, and functions
- Barrel exports (`index.ts`) for module entry points
- Avoid default exports for better IDE support

## 3. Documentation Standards

### 3.1 JSDoc Requirements

All public and protected APIs MUST have JSDoc comments:

```typescript
/**
 * Registers a tool with the environment.
 *
 * @param tool - The tool or tool info to register
 * @example
 * ```typescript
 * env.registerTool(createBashTool());
 * ```
 */
registerTool(tool: Tool | ToolInfo): void;
```

### 3.2 Required JSDoc Tags

| Tag | Usage |
|-----|-------|
| `@description` | Brief explanation of the class/method |
| `@param` | Parameter description with type |
| `@returns` | Return value description |
| `@example` | Code example (required for public APIs) |
| `@throws` | Possible exceptions |
| `@see` | Related references |

### 3.3 Class Documentation

Every class MUST have:

```typescript
/**
 * Manages execution timeouts for tool invocations.
 *
 * Provides configurable timeout policies with per-tool overrides,
 * supporting both default and custom timeout durations.
 *
 * @example
 * ```typescript
 * const manager = new TimeoutManager({ defaultTimeoutMs: 30000 });
 * manager.setTimeout("bash", 60000);
 * ```
 */
export class TimeoutManager { }
```

### 3.4 Complex Logic Comments

Add inline comments for:
- Non-obvious algorithm choices
- Performance considerations
- Edge cases and their handling
- TODO items (with ticket reference)

```typescript
// Use exponential backoff to prevent thundering herd
// Max delay capped at 30 seconds to avoid excessive waits
const delay = Math.min(baseDelay * Math.pow(2, attempt), MAX_DELAY);
```

## 4. Error Handling

### 4.1 Error Types

Define specific error types for different failure modes:

```typescript
export class ToolExecutionError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly attempt: number,
    message: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}
```

### 4.2 Error Handling Principles

- Never swallow errors silently
- Include context in error messages
- Use specific error types for recoverable vs. fatal errors
- Log errors at appropriate levels

## 5. Testing Requirements

### 5.1 Test Coverage

- Unit tests: > 80% coverage for core modules
- Integration tests for env implementations
- E2E tests for critical workflows

### 5.2 Test Organization

```
test/
├── unit/           # Unit tests (one file per source file)
├── integration/    # Integration tests
└── e2e/           # End-to-end tests
```

## 6. Git Workflow

### 6.1 Branch Naming

- `feat/*` - New features
- `fix/*` - Bug fixes
- `docs/*` - Documentation changes
- `refactor/*` - Code refactoring
- `chore/*` - Maintenance tasks

### 6.2 Commit Messages

**All commit messages must be written in English.**

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`

### 6.3 Pull Request Requirements

- All tests must pass
- Code must be formatted (`bun run format`)
- Type check must pass (`bun run typecheck`)
- Documentation updated for API changes

## 7. Performance Guidelines

### 7.1 Async Operations

- Use `Promise` for async operations
- Avoid blocking operations
- Implement proper cancellation with `AbortSignal`

### 7.2 Memory Management

- Avoid memory leaks in long-running agents
- Clean up subscriptions and event handlers
- Use weak references where appropriate

## 8. Security Considerations

### 8.1 Tool Safety

- Validate all tool parameters with Zod schemas
- Sanitize file paths in file operations
- Limit command execution scope

### 8.2 Sensitive Data

- Never log sensitive information
- Use environment variables for credentials
- Implement proper output sanitization

## 9. API Stability

### 9.1 Versioning

Follow Semantic Versioning (SemVer):
- `MAJOR`: Breaking changes
- `MINOR`: New features (backward compatible)
- `PATCH`: Bug fixes (backward compatible)

### 9.2 Deprecation

Mark deprecated APIs with `@deprecated` JSDoc tag:

```typescript
/**
 * @deprecated Use `registerTool()` instead. Will be removed in v2.0.0
 */
addTool(tool: Tool): void;
```

## 10. Frontend-Backend Integration Testing

> ⚠️ **Windows Users: Use PowerShell**
> 
> On Windows, you **MUST** use **PowerShell** (not Git Bash) for integration testing.
> Git Bash has file system path compatibility issues that prevent logs from being written correctly.
> 
> ```powershell
> # Correct way on Windows
> $env:LOG_FILE="../../../logs/server.log"; bun run start
> 
> # Incorrect - won't work properly
> LOG_FILE=../../../logs/server.log bun run start  # Git Bash - avoids
> ```

### 10.0 Pre-Testing Checklist

Before starting integration tests, you **MUST** verify the environment:

#### 1. Port Availability Check

**⚠️ CRITICAL: Always check and clear port usage before testing**

The server port (default: 3001) must be free before starting:

```bash
# Check if port is in use (Linux/Mac)
netstat -ano | grep :3001

# Check if port is in use (Windows PowerShell)
Get-NetTCPConnection -LocalPort 3001

# If port is occupied, kill the process
# Windows:
taskkill /PID <PID> /F

# Linux/Mac:
kill -9 <PID>

# Or use the provided cleanup script
pkill -9 bun
```

**Failure to clear ports will result in:**
- Server startup errors: "Failed to start server. Is port 3001 in use?"
- Incomplete test results
- Missing log entries

#### 2. Log Directory Preparation

```bash
# Ensure log directory exists
mkdir -p ~/.config/tong_work/logs

# Clear old logs for clean testing
rm -f ~/.config/tong_work/logs/*.log
```

When developing features that involve both frontend (TUI) and backend (Server), you MUST follow this integration testing workflow. **All testing should be automated via scripts or tools, not manual.**

### 10.1 Automated Integration Test Script

Create and run the integration test script:

```bash
# From agent-core root directory
bun run test:integration
```

This script will:
1. Start server in background with logging
2. Wait for server to be ready
3. Start TUI with mock inputs
4. Capture all logs
5. Analyze results
6. Report pass/fail status

### 10.2 Log-Based Debugging

Both server and client MUST output detailed logs to files for analysis.

#### Prerequisites

**1. Create logs directory** (first time only):
```bash
mkdir -p logs
```

**2. Configure logging in `.env` file** (Recommended):

Add the following to your `agent-core/.env` file:
```env
# LLM Configuration
LLM_MODEL=moonshot/kimi-k2.5
LLM_API_KEY=your-api-key

# Logging Configuration (paths relative to packages/core/)
LOG_FILE=../../../logs/server.log
LOG_LEVEL=debug
```

**Note**: The logger will automatically read `LOG_FILE` from environment variables. Paths should be relative to the directory where you run the command (`packages/core/`).

#### Alternative: Command-line Environment Variables

If you prefer not to modify `.env`, set environment variables when running:

**Server:**
```bash
cd packages/core

# Linux/Mac
export LOG_FILE="../../../logs/server.log"
export LOG_LEVEL="debug"
bun run start

# Windows PowerShell
$env:LOG_FILE="../../../logs/server.log"
$env:LOG_LEVEL="debug"
bun run start
```

**Client:**
```bash
cd packages/core

# Linux/Mac
export LOG_FILE="../../../logs/tui.log"
export LOG_LEVEL="debug"
export TUI_TEST_INPUTS="hello;delay:3000;exit"
bun run dev attach http://localhost:3001

# Windows PowerShell
$env:LOG_FILE="../../../logs/tui.log"
$env:LOG_LEVEL="debug"
$env:TUI_TEST_INPUTS="hello;delay:3000;exit"
bun run dev attach http://localhost:3001
```

#### Log File Locations
```
logs/
├── server.log          # Server-side logs
└── tui.log            # Client-side TUI logs
```

#### Key Log Events to Verify (in order)

**Server Side - Event Flow:**
1. `[INFO] [sse] Client connected` - SSE connection established
2. `[INFO] [session] Received prompt request` - Prompt received
3. `[INFO] [session] Added user message` - Message stored
4. `[INFO] [session] Starting AI processing` - AI processing begun
5. `[DEBUG] [sse] Sending event to client` {type: "stream.start"} - Stream started
6. `[DEBUG] [sse] Sending event to client` {type: "stream.text"} - Content streaming
7. `[INFO] [session] AI processing completed` - Response ready

**Client Side - Event Flow:**
1. `[INFO] [tui:event] Connected to event stream` - SSE connected
2. `[INFO] [tui:event] Sending prompt` - Prompt sent
3. `[INFO] [tui:event] Added user message to store` - UI updated
4. `[INFO] [tui:event] Received event: stream.start` - Stream started
5. `[DEBUG] [tui:event] Text chunk received` - Content streaming
6. `[INFO] [tui:event] Stream completed` - Response complete

### 10.3 Automated Testing with Mock Input

Use `TUI_TEST_INPUTS` environment variable to automate TUI testing:

#### Test Input Format
- `text` - Send text input (e.g., "hello")
- `delay:ms` - Wait milliseconds (e.g., "delay:2000")
- `exit` - Exit TUI

#### Example Test Scenarios

**Scenario 1: Basic greeting**
```bash
TUI_TEST_INPUTS="hello;delay:3000;exit" bun run dev attach http://localhost:3001
```

**Scenario 2: Multi-turn conversation**
```bash
TUI_TEST_INPUTS="hello;delay:2000;what can you do;delay:3000;thank you;delay:2000;exit" \
  bun run dev attach http://localhost:3001
```

**Scenario 3: Tool invocation test**
```bash
TUI_TEST_INPUTS="list files in current directory;delay:5000;exit" \
  bun run dev attach http://localhost:3001
```

### 10.4 Log Analysis Commands

After running tests, analyze logs to verify flow:

```bash
# Check server received the prompt
grep "Received prompt request" logs/server.log

# Check events were sent (should see multiple)
grep "Sending event to client" logs/server.log | head -10

# Check client received events
grep "Received event" logs/tui.log

# Check for errors
grep "ERROR" logs/*.log

# Full event flow timeline
cat logs/server.log | grep -E "Client connected|Received prompt|AI processing|Sending event"
cat logs/tui.log | grep -E "Connected|Sending prompt|Received event|Stream completed"
```

### 10.5 Integration Checklist

Before marking a feature complete, verify via automated testing:

**Server Verification:**
- [ ] Log shows `[INFO] [sse] Client connected`
- [ ] Log shows `[INFO] [session] Received prompt request`
- [ ] Log shows `[INFO] [session] Starting AI processing`
- [ ] Log shows `[DEBUG] [sse] Sending event to client` (multiple times)
- [ ] Log shows `[INFO] [session] AI processing completed`
- [ ] No ERROR entries in server.log

**Client Verification:**
- [ ] Log shows `[INFO] [tui:event] Connected to event stream`
- [ ] Log shows `[INFO] [tui:event] Sending prompt`
- [ ] Log shows `[INFO] [tui:event] Received event: stream.start`
- [ ] Log shows `[DEBUG] [tui:event] Text chunk received`
- [ ] Log shows `[INFO] [tui:event] Stream completed`
- [ ] No ERROR entries in tui.log

**End-to-End Verification:**
- [ ] Mock input test passes (TUI_TEST_INPUTS)
- [ ] All expected log events present in correct order
- [ ] No missing events between server and client
- [ ] Manual interactive test passes (if applicable)

### 10.6 Common Issues & Solutions

**Issue: Client not receiving events**
- Check server logs for `Sending event to client`
- Verify sessionId matches between client and server
- Check SSE connection is maintained (no disconnect/reconnect during streaming)
- Verify event format is flattened: `{type, properties}` -> `{type, ...properties}`

**Issue: Stream not starting**
- Verify LLM is configured (`LLM_MODEL`, `LLM_API_KEY`)
- Check server logs for `Starting AI processing`
- Verify event bus is publishing events
- Check that ServerEnvironment is properly initialized in context

**Issue: TUI not displaying content**
- Check client logs for `Received event`
- Verify event types match expected format (e.g., `stream.text` not `text`)
- Check component rendering logs
- Verify SolidJS batch updates are working correctly

**Issue: Connection refused**
- Ensure server is running before starting client
- Check server port matches client URL
- Verify no firewall blocking localhost:3001

### 10.7 Platform-Specific Notes

#### Windows PowerShell
```powershell
# Use semicolon and backtick for multi-line
$env:LOG_FILE="../../../logs/server.log"; `
$env:LOG_LEVEL="debug"; `
bun run start
```

#### Windows CMD
```cmd
set LOG_FILE=../../../logs/server.log
set LOG_LEVEL=debug
bun run start
```

#### Linux/Mac
```bash
LOG_FILE=../../../logs/server.log LOG_LEVEL=debug bun run start
```

## 11. Review Checklist

Before submitting code, verify:

- [ ] Code follows naming conventions
- [ ] JSDoc comments complete for all public APIs
- [ ] Examples provided for new features
- [ ] TypeScript compilation passes
- [ ] No `any` or `as any` without justification
- [ ] Error handling is comprehensive
- [ ] Performance considerations addressed
- [ ] Security implications reviewed
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] **Integration testing completed (Section 10)**
