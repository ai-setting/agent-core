import type { SkillInfo } from "../core/environment/skills/types.js";

/**
 * Built-in skills for agent-core
 * 
 * When adding new built-in skills:
 * 1. Add a new property to BUILT_IN_SKILLS with the skill metadata and content
 * 2. The skill content is stored directly as a string in the code
 */

export const BUILT_IN_SKILLS: SkillInfo[] = [
  {
    id: "tong_work_help",
    name: "tong_work_help",
    description: `Get help on tong_work or agent-core. Use this skill when users ask about:
- Configuration: MCP servers, providers, Environment settings, auth
- Usage: how to use features, commands, workflows
- Architecture: how the system works, Environment layers, tool registration
- Development: debugging, troubleshooting, source code analysis
- Questions about tong_work product or agent-core core engine

This skill provides configuration guide, environment mechanism explanation, skill development guide, command reference, troubleshooting help, and source code reading capabilities (fetch_agent_core_source).`,
    content: `---
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
How to create custom skills, skill format, loading mechanism.

### 4. Commands (commands)
Server commands, built-in commands (/models, /agent-env, /sessions).

### 5. Source Code Analysis (source-code)
How to use fetch_agent_core_source tool to read and analyze source code.

### 6. Troubleshooting (troubleshooting)
Log locations, debugging tools (list_request_ids, get_first_log_for_request, get_logs_for_request, get_trace), common issues. Use trace_analysis skill for log analysis.

---

## Source Code Analysis

Use \`fetch_agent_core_source\` tool to fetch source code from GitHub for analysis.

### Tool: fetch_agent_core_source

\`\`\`
fetch_agent_core_source({
  path: "packages/core/src/server/environment.ts",
  commit: "abc123",
  language: "typescript",
  localPath: "/tmp/agent-core/environment.ts"
})
\`\`\`

### Workflow for Analyzing Source Code

1. Fetch source to local path
2. Read and analyze the local file using file_read or grep tools

### Arguments

| Parameter | Type | Description |
|-----------|------|-------------|
| path | string | File path in repository |
| commit | string | Optional commit hash |
| language | string | Optional programming language |
| localPath | string | Optional absolute path to save |

---

## Debugging Tools

### trace_analysis skill
Use the trace_analysis skill for log and trace analysis. It provides:
- list_request_ids: List all unique requestIds in a log file
- get_first_log_for_request: Get first log entry for each requestId (contains user query)
- get_logs_for_request: Get all logs for a specific requestId
- get_trace: Get trace/call chain for a requestId

### Workflow

1. Call list_request_ids to get recent requestIds
2. Call get_first_log_for_request to show first log (with query) for each
3. Let user select which requestId to investigate
4. Call get_logs_for_request to get full logs

---

## Log Locations

- Server: ~/.local/share/tong_work/logs/server.log
- TUI: ~/.local/share/tong_work/logs/tui.log

---

## Usage

\`\`\`
skill(skill="tong_work_help")
\`\`\`

Or ask questions naturally.

---

*Current agent-core version info: Version 0.1.0 (dev), Commit: d912ead3d34d7c73177c0d523de3c31ecccccf64*`,
  },
  {
    id: "trace_analysis",
    name: "trace_analysis",
    description: `Analyze logs and traces for debugging. Use this skill when users want to:
- View recent logs and request history
- Investigate specific request issues
- Analyze trace data and call chains

This skill provides structured workflows for log analysis using list_request_ids, get_first_log_for_request, get_logs_for_request, and get_trace tools.`,
    content: `---
name: trace_analysis
description: Analyze logs and traces for debugging. Provides structured workflows for investigating request history and trace data.
---

# trace_analysis

This skill provides log and trace analysis capabilities for debugging.

## Available Tools

### list_request_ids
List all unique requestIds in a log file, sorted by time (newest first). Returns each requestId with its first and last log timestamp.

Parameters:
- filename: Log filename (e.g., server.log, tui.log)
- limit: Maximum number of requestIds to return (default: 50)
- offset: Offset for pagination (use with limit to paginate through requestIds)

### get_first_log_for_request
Get the first log entry for each specified requestId. The first entry typically contains the user's query.

Parameters:
- filename: Log filename
- requestIds: Array of requestIds to get first log for

### get_logs_for_request
Get all log entries for a specific requestId. Supports pagination with offset and limit.

Parameters:
- filename: Log filename
- requestId: The requestId to get all logs for
- offset: Line offset to start from (default: 0)
- limit: Maximum lines to return (default: 500)

### get_trace
Get trace/call chain for a requestId. Returns formatted call chain visualization.

Parameters:
- requestId: The requestId/traceId to query
- format: Output format (text or json)

## Workflows

### View Recent Logs

1. Call \`list_request_ids\` with appropriate limit to get recent requestIds
2. Call \`get_first_log_for_request\` to show first log (with query) for each
3. Present the results to user and let them select which requestId to investigate
4. Call \`get_logs_for_request\` to get full logs for the selected requestId
5. If needed, call \`get_trace\` to get the call chain visualization

### View Specific Request

1. Call \`get_first_log_for_request\` to show the query
2. Call \`get_logs_for_request\` to get all logs
3. If needed, call \`get_trace\` for trace analysis

### Browse Historical Logs (Large Time Range)

When user wants to view logs from a specific time period or browse through older requests:

1. Use \`list_request_ids\` with \`offset\` and \`limit\` for pagination:
   - First call: \`list_request_ids({ filename: "server.log", limit: 20, offset: 0 })\`
   - Next page: \`list_request_ids({ filename: "server.log", limit: 20, offset: 20 })\`
   - And so on: offset: 40, 60, 80... to browse through older requests

2. After finding interesting requestIds, use \`get_first_log_for_request\` to see what each request was about

3. Then use \`get_logs_for_request\` with \`offset\` and \`limit\` to paginate through the logs for a specific requestId

**Tips for Large Log Files:**
- Use smaller \`limit\` values (e.g., 10-20) for faster responses
- Use \`offset\` to step through requestIds sequentially
- Check the \`firstLogTime\` and \`lastLogTime\` in the response to identify the time range you're interested in

---

*Current agent-core version info: Version 0.1.0 (dev)*`,
  },
];

export function getBuiltInSkillById(id: string): SkillInfo | undefined {
  return BUILT_IN_SKILLS.find(s => s.id === id);
}
