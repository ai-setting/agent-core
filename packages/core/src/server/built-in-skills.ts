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
    description: "Get help on tong_work or agent-core configuration, usage, and architecture. Includes troubleshooting, debugging tools, and how to read source code for analysis.",
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
Log locations, debugging tools (search_logs, get_trace), common issues.

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

### search_logs
Search and filter log files:
- filename: Log filename
- requestId: Filter by requestId/traceId
- traceFilter: enter/quit/error
- keyword: Additional keyword filter

### get_trace
Get trace/call chain for a requestId

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
];

export function getBuiltInSkillById(id: string): SkillInfo | undefined {
  return BUILT_IN_SKILLS.find(s => s.id === id);
}
