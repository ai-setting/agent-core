# tong_work Architecture Refactor and Build System Design

## Overview

This document describes the architectural refactoring of agent-core from a multi-package workspace structure to a monolithic architecture, along with the design and implementation of the binary build system.

## Architecture Refactor

### Before: Multi-Package Workspace

```
agent-core/
├── packages/
│   ├── core/              # Core framework
│   ├── app/
│   │   ├── server/        # HTTP Server
│   │   ├── cli/           # CLI tool
│   │   ├── web/           # Web app (placeholder)
│   │   └── desktop/       # Desktop app (placeholder)
├── package.json           # Workspaces configuration
└── ...
```

**Problems:**
- Complex workspace dependency management
- Cross-package imports issues during bundling
- Bun compile couldn't resolve workspace dependencies
- Separate build processes for each package

### After: Monolithic Architecture

```
agent-core/
└── packages/core/         # Single monolithic package
    ├── src/
    │   ├── core/         # Core framework (agent, environment, tools)
    │   ├── server/       # HTTP Server with SSE
    │   └── cli/          # CLI tool
    ├── dist/             # Built output
    ├── package.json      # Single package configuration
    └── tsconfig.json
```

**Benefits:**
- All code in one package, no workspace complexity
- Direct relative imports between core/server/cli
- Single build process
- Bun compile works correctly
- Easier to maintain and understand

### Import Path Changes

**Before (workspace imports):**
```typescript
import { BaseEnvironment } from "agent-core/environment/base/base-environment";
import type { Context } from "agent-core/types/context";
```

**After (relative imports):**
```typescript
import { BaseEnvironment } from "../core/environment/base/base-environment.js";
import type { Context } from "../core/types/context.js";
```

## Build System Design

### Build Script (`packages/core/scripts/build.ts`)

The build system uses Bun's compile feature to create standalone binaries.

#### Features

1. **Multi-Platform Support**
   - Linux: x64, ARM64, x64-musl, ARM64-musl
   - macOS: x64, ARM64 (Apple Silicon)
   - Windows: x64
   - Baseline variants for older CPUs

2. **Build Process**
   ```typescript
   await Bun.build({
     entrypoints: [path.join(ROOT, "src", "cli", "index.ts")],
     compile: {
       target: targetTriple,  // e.g., "bun-linux-x64"
       outfile,
       autoloadBunfig: false,
       autoloadDotenv: false,
     },
     define: {
       TONG_WORK_VERSION: `"${VERSION}"`,
       TONG_WORK_CHANNEL: `"${CHANNEL}"`,
     },
   });
   ```

3. **Build Commands**
   ```bash
   # Build for current platform only
   bun run build:binary:single
   
   # Build for all platforms
   bun run build:binary
   
   # Build and create release archives
   bun run build:release
   ```

#### Target Matrix

| Target | OS | Arch | Notes |
|--------|-----|------|-------|
| tong_work-linux-x64 | Linux | x64 | Standard glibc build |
| tong_work-linux-arm64 | Linux | ARM64 | For ARM servers |
| tong_work-linux-x64-baseline | Linux | x64 | Without AVX2 |
| tong_work-linux-arm64-musl | Linux | ARM64 | Alpine Linux |
| tong_work-linux-x64-musl | Linux | x64 | Alpine Linux |
| tong_work-darwin-arm64 | macOS | ARM64 | Apple Silicon |
| tong_work-darwin-x64 | macOS | x64 | Intel Macs |
| tong_work-windows-x64 | Windows | x64 | Windows 10/11 |

### CI/CD Pipeline (GitHub Actions)

Workflow file: `.github/workflows/build.yml`

#### Pipeline Stages

1. **Test Stage**
   - Runs on Ubuntu
   - Installs Bun
   - Runs typecheck
   - Runs all unit tests

2. **Build Stage** (Parallel)
   - Runs on multiple OS runners
   - Builds TypeScript
   - Creates platform-specific binaries
   - Uploads artifacts

3. **Release Stage** (Conditional)
   - Triggered on version tags
   - Downloads all artifacts
   - Creates archives (tar.gz for Linux, zip for others)
   - Creates GitHub Release

#### Usage

```yaml
# Push to main - runs tests and builds
push:
  branches: [main, master, dev]

# Push tag - creates release
push:
  tags: ['v*']

# Manual trigger
workflow_dispatch:
```

## CLI Implementation

### Commands

```bash
tong_work version           # Show version info
tong_work serve             # Start HTTP server
tong_work run <message>     # Run task with auto-server
tong_work attach <url>      # Attach to running server
```

### Run Command Flow

1. Load `.env` configuration
2. Find Bun runtime in system PATH
3. Spawn server subprocess
4. Wait for server health check
5. Create session
6. Send message to LLM
7. Stream response via SSE
8. Display formatted output
9. Shutdown server

### Server Features

- **HTTP API**: RESTful endpoints for sessions and prompts
- **SSE**: Server-Sent Events for real-time streaming
- **Session Management**: Create, list, and manage sessions
- **Event Bus**: Type-safe publish/subscribe for events
- **Environment Integration**: Full agent-core environment support

## Testing

### Test Coverage

- **51 unit tests** across 6 test files
- All tests passing
- 114 expect() calls

### Test Files

- `src/server/environment.test.ts` - ServerEnvironment tests
- `src/server/eventbus/bus.test.ts` - Event bus tests

### Running Tests

```bash
# Run all tests
bun run test

# Run with coverage
bun test --coverage
```

## Usage Examples

### Development

```bash
# Development mode
bun run dev

# Run task
bun run run "Hello, who are you?"

# Start server
bun run start

# Attach to server
bun run attach http://localhost:4096
```

### Production (Binary)

```bash
# Build binary
bun run build:binary:single

# Use binary
./packages/core/dist/tong_work-windows-x64/bin/tong_work.exe run "Hello"
```

## Configuration

### Environment Variables

```bash
# LLM Configuration
LLM_MODEL=openai/gpt-4o-mini       # Model name
LLM_API_KEY=sk-xxx                 # API key
LLM_BASE_URL=https://api.openai.com/v1  # Optional base URL

# Server Configuration
PORT=4096                          # Server port
HOSTNAME=localhost                 # Server host
```

### .env File

Create `.env` in project root:
```env
LLM_MODEL=openai/gpt-4o-mini
LLM_API_KEY=sk-your-key-here
PORT=4096
```

## Migration Guide

### From Old Structure

1. Update imports from `agent-core/...` to relative paths
2. Move code into `packages/core/src/core/`, `server/`, or `cli/`
3. Update `package.json` dependencies
4. Run tests to verify

### API Compatibility

- Core API remains unchanged
- Server API endpoints unchanged
- CLI commands enhanced with new features

## Future Improvements

1. **Standalone Binary**: Bundle Bun runtime into single executable
2. **Plugin System**: Allow dynamic tool loading
3. **Web Interface**: Built-in web UI
4. **Docker Support**: Official Docker images
5. **Package Managers**: Publish to npm, homebrew, etc.

## References

- [Bun Compile Documentation](https://bun.sh/docs/bundler/executables)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- Original design: `docs/CLI_BUILD_PLAN.md`
