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

## 10. Review Checklist

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
