---
name: tong_work_help
description: Get help on tong_work or agent-core configuration, usage, and architecture. Includes troubleshooting, debugging tools, and how to read source code for analysis.
---

# tong_work_help

This is the built-in help Skill for tong_work. It provides comprehensive guidance on configuration, usage, and architecture.

## Available Help Topics

### 1. Configuration (config)
User-level and environment-level configuration system, ConfigSource abstraction, common config items.

### 2. Environment Mechanism (environment)
BaseEnvironment, ServerEnvironment, OsEnvironment layered design, core methods.

### 3. Skill Development (skill-dev)
How to create custom skills, skill.md format, loading mechanism.

### 4. Commands (commands)
Server commands, built-in commands (/models, /agent-env, /sessions).

### 5. Source Code Analysis (source-code)
How to use fetch_agent_core_source tool to read and analyze source code.

### 6. Troubleshooting (troubleshooting)
Log locations, debugging tools (search_logs, get_trace), common issues.

---

## Source Code Analysis

Use `fetch_agent_core_source` tool to fetch source code from GitHub for analysis.

### Tool: fetch_agent_core_source

```
fetch_agent_core_source({
  path: "packages/core/src/server/environment.ts",
  commit: "abc123",  // optional, defaults to current running version
  language: "typescript",  // optional
  localPath: "/tmp/agent-core/environment.ts"  // optional: save to local file
})
```

### Workflow for Analyzing Source Code

1. **Fetch source to local path**:
   ```
   fetch_agent_core_source({
     path: "packages/core/src/server/environment.ts",
     localPath: "/tmp/agent-core/environment.ts"
   })
   ```

2. **Read and analyze the local file**:
   Use file_read or grep tools to analyze the downloaded source code.

### Arguments

| Parameter | Type | Description |
|-----------|------|-------------|
| path | string | File path in repository (e.g., packages/core/src/server/environment.ts) |
| commit | string | Optional commit hash or branch (defaults to current running version) |
| language | string | Optional programming language for syntax highlighting |
| localPath | string | Optional absolute path to save file locally |

### Key Source Files

- ServerEnvironment: packages/core/src/server/environment.ts
- BaseEnvironment: packages/core/src/core/environment/base/base-environment.ts
- Config: packages/core/src/config/index.ts
- Skills: packages/core/src/core/environment/skills/
- Trace Tools: packages/core/src/tools/trace/

---

## Debugging Tools

### search_logs
Search and filter log files.

```
search_logs({
  filename: "server.log",
  requestId: "abc123",  // filter by requestId/traceId
  traceFilter: "error",  // enter/quit/error
  keyword: "connection",
  limit: 50
})
```

TRACE tags:
- `enter`: >>> (function entry)
- `quit`: <<< (function exit)
- `error`: !!! (errors)

### get_trace
Get trace/call chain for a requestId.

```
get_trace({
  requestId: "abc123",
  format: "text"  // or "json"
})
```

---

## Log Locations

- Server: ~/.local/share/tong_work/logs/server.log
- TUI: ~/.local/share/tong_work/logs/tui.log
- Tools: ~/.local/share/tong_work/logs/tools.log

---

## Usage

Call skill tool:
```
skill(skill="tong_work_help")
```

Or ask questions naturally:
- "How do I configure MCP servers?"
- "Show me how fetch_agent_core_source works"
- "Help me understand the Environment design"
- "How to use search_logs to debug?"
