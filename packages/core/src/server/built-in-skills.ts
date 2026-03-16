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
    description: `日志和Trace分析调试 Skill。Use this skill when users want to:
- View recent logs and request history / 查看最近日志、请求历史
- Investigate specific request issues / 查看具体请求日志、调试问题
- Analyze trace data and call chains / 分析调用链、Trace追踪
- 查询日志、检索日志、查看日志详情
- 查看某个 requestId 的日志
- 帮我看下日志、帮我查下日志
- 最近的query日志、请求日志分析

This skill provides structured workflows for log analysis using list_request_ids, get_first_log_for_request, get_logs_for_request, and get_trace tools.`,
    content: `---
name: trace_analysis
description: 日志和Trace分析调试 Skill。Provides structured workflows for investigating request history and trace data.
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
Get all log entries for a specific requestId. Supports pagination with offset and limit, and time range filtering.

Parameters:
- filename: Log filename
- requestId: The requestId to get all logs for
- offset: Line offset to start from (default: 0)
- limit: Maximum lines to return (default: 500)
- startTime: Filter logs from this time (optional). Format: '2026-03-16 11:43:59' or '11:43:59'
- endTime: Filter logs until this time (optional). Format: '2026-03-16 11:44:00' or '11:44:00'

### get_trace
Get the trace/call chain for a given requestId. Returns formatted call tree showing the execution flow with duration and timing info.

Parameters:
- requestId: The requestId/traceId to query (can be exact match or partial match)

Returns:
- Formatted text with span tree, duration, and timestamps
- Each span shows: name, duration, startTime→endTime, spanId (last 8 chars)
- Shows overall time range at the top
- Total span count
- **Tip: Use the spanId from this output to get detailed info with get_span_detail**

### get_span_detail
Get detailed information for a specific span by spanId. Use this after get_trace to dive into specific function calls.

Parameters:
- spanId: The spanId to get detailed information for (you can get this from get_trace output)

Returns:
- Complete span info: spanId, traceId, parentSpanId
- Timing: startTime, endTime, duration
- Params/Attributes (the input parameters)
- Result (if recorded - may be truncated for large data)
- Error (if any)
- Children list

## 🔍 Recommended Workflow for Log Investigation

### Step 1: Find the Request
Use \`list_request_ids\` to find the requestId you're interested in:

\`\`\`
list_request_ids({
  filename: "server.log",
  limit: 20
})
\`\`\`

### Step 2: Get Query Context
Use \`get_first_log_for_request\` to see what the user asked:

\`\`\`
get_first_log_for_request({
  filename: "server.log",
  requestIds: ["req_xxx"]
})
\`\`\`

### Step 3: Get Call Flow Overview (Recommended First!)
Use \`get_trace\` to get an overview of the execution flow:

\`\`\`
get_trace({
  requestId: "req_xxx"
})
\`\`\`

This shows:
- The complete call chain tree
- Duration for each span
- **spanId for each call** (shown in parentheses)
- Total span count

Example output:
\`\`\`
Trace: req_xxx
💡 Tip: Use get_span_detail with spanId to get detailed info

✓ session.get [0ms] (spanId: span_xxx1)
✓ env.handle_query [1784ms] (spanId: span_xxx2)
  ✓ agent.run [1774ms] (spanId: span_xxx3)
    ✓ env.invokeLLM [1761ms] (spanId: span_xxx4)

📋 Total spans: 12
\`\`\`

### Step 4: Get Detailed Span Info
Use \`get_span_detail\` with a spanId from Step 3 to get detailed info:

\`\`\`
get_span_detail({
  spanId: "span_xxx4"
})
\`\`\`

This shows:
- Full params/attributes (input data)
- Result (output data, if recorded)
- Error details (if any)
- Timing information

### Step 5: Deep Dive with Logs
If you need more context, use \`get_logs_for_request\` to see raw logs:

\`\`\`
get_logs_for_request({
  filename: "server.log",
  requestId: "req_xxx",
  offset: 0,
  limit: 100
})
\`\`\`

---

## 💡 Tips for Effective Debugging

1. **Always start with get_trace** - It gives you a quick overview of the call flow without overwhelming details

2. **Use spanId to drill down** - Instead of reading all logs, use get_span_detail on specific spans

3. **Focus on slow spans** - Look for spans with long duration in get_trace output

4. **Check for errors** - Look for ✗ status in trace, then use get_span_detail to see error messages

5. **Use time range to filter logs** - When logs are too long, use get_trace to find the time range, then use startTime/endTime in get_logs_for_request to filter:
   \`\`\`
   get_logs_for_request({
     filename: "server.log",
     requestId: "req_xxx",
     startTime: "11:43:59",  // or "2026-03-16 11:43:59"
     endTime: "11:44:00",    // or "2026-03-16 11:44:00"
     limit: 100
   })
   \`\`\`
   This avoids getting truncated results due to too much data!

6. **Understand the flow**: 
   - High-level: list_request_ids → get_trace → get_span_detail
   - Deep dive: add get_logs_for_request when needed (use time range to limit!)

---

## Example Investigation

### Problem: LLM response seems wrong

1. \`list_request_ids\` → find requestId for the problematic query
2. \`get_first_log_for_request\` → confirm what user asked
3. \`get_trace\` → see if LLM was called, how long it took
4. \`get_span_detail\` on env.invokeLLM span → see the full prompt and response
5. \`get_logs_for_request\` → check for any errors in logs

---

*Current agent-core version info: Version 0.1.0 (dev)*`,
  },
];

export function getBuiltInSkillById(id: string): SkillInfo | undefined {
  return BUILT_IN_SKILLS.find(s => s.id === id);
}
