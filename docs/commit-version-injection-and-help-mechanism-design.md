# Runtime Source Awareness and Built-in Help Mechanism Design

> This document describes how to implement: 1) Build-time Git Commit version injection; 2) GitHub source code fetching Tool; 3) Built-in tong_work_help Skill

## 0. tong_work and agent-core Relationship

```
+-------------------------------------------------------------+
|                         tong_work                           |
|              (Enterprise Task Autonomous System)             |
+-------------------------------------------------------------+
|                                                             |
|   +-----------------------------------------------------+   |
|   |                       agent-core                     |   |
|   |                   (Core Engine)                     |   |
|   +-----------------------------------------------------+   |
|   |  - Environment layered design                       |   |
|   |  - Tool registration and governance                |   |
|   |  - Event bus and SSE                               |   |
|   |  - MCP/Skills/Sub-agents abstraction              |   |
|   |  - Config system (ConfigSource)                    |   |
|   +-----------------------------------------------------+   |
|                                                             |
|   Config: ~/.config/tong_work/agent-core/                   |
+-------------------------------------------------------------+
```

- **tong_work**: Product name, enterprise task autonomous propulsion system
- **agent-core**: Core engine of tong_work, responsible for agent runtime context, tool governance, event mechanisms, etc.
- **Relationship**: agent-core is the underlying architecture of tong_work

---

## 1. Background and Goals

### 1.1 Background

- **Version awareness missing**: Binary runtime cannot perceive Git Commit version at build time
- **Source code inaccessible**: Users cannot directly access agent-core source code at runtime
- **Help lacks basis**: Static help information, not integrated with runtime code

### 1.2 Design Goals

| Goal | Description |
|------|-------------|
| **Version Injection** | Inject Git Commit Hash into binary at build time, accessible via Environment property |
| **Source Code Tool** | Provide Tool to fetch agent-core repository source from GitHub at specific commit |
| **Built-in Help Skill** | Built-in `tong_work_help` Skill with comprehensive help content, updated over time |

---

## 2. Solution Overview

```
+-------------------------------------------------------------+
|                      Build Time (bun run build)              |
+-------------------------------------------------------------+
|  1. build.ts gets current Git Commit Hash                  |
|  2. Inject TONG_WORK_COMMIT into binary via Bun.define      |
|  3. Package built-in tong_work_help Skill (static Markdown) |
+-------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------+
|                      Runtime (ServerEnvironment)             |
+-------------------------------------------------------------+
|  4. Read TONG_WORK_COMMIT constant, expose as              |
|     env.getCommitVersion()                                  |
|  5. Register fetch_agent_core_source Tool                   |
|  6. tong_work_help Skill provides help content              |
|     (users call via skill() tool)                           |
+-------------------------------------------------------------+
```

---

## 3. Detailed Design

### 3.1 Version Injection

#### 3.1.1 Modify build.ts

**File**: `packages/core/scripts/build.ts`

```typescript
// Get current Git Commit Hash
const COMMIT_HASH = (await $`git rev-parse HEAD`.text()).trim();

// Add to Bun.build define
define: {
  TONG_WORK_VERSION: `"${VERSION}"`,
  TONG_WORK_CHANNEL: `"${CHANNEL}"`,
  TONG_WORK_COMMIT: `"${COMMIT_HASH}"`,
}
```

#### 3.1.2 Expose Version in Environment

**File**: `packages/core/src/config/prompts/variables.ts`

```typescript
declare const TONG_WORK_COMMIT: string;

export function buildEnvInfo(envName: string, workdir?: string): string {
  // ... existing code
  
  if (typeof TONG_WORK_COMMIT !== "undefined") {
    parts.push(`Commit: ${TONG_WORK_COMMIT}`);
  }
  
  return parts.join("\n");
}
```

#### 3.1.3 Environment Interface Extension

**File**: `packages/core/src/core/environment/index.ts`

```typescript
export interface Environment {
  // ... existing methods
  
  /**
   * Get current agent-core Git Commit version
   * Injected at build time via TONG_WORK_COMMIT
   */
  getCommitVersion(): string;
}
```

**File**: `packages/core/src/core/environment/base/base-environment.ts`

```typescript
declare const TONG_WORK_COMMIT: string;

getCommitVersion(): string {
  if (typeof TONG_WORK_COMMIT !== "undefined") {
    return TONG_WORK_COMMIT;
  }
  return "unknown";
}
```

---

### 3.2 GitHub Source Code Fetching Tool

**File**: `packages/core/src/tools/github/fetch-agent-core-source.ts`

```typescript
import { z } from "zod";
import type { ToolInfo, ToolResult, ToolContext } from "../../core/types/index.js";
import fs from "fs";
import path from "path";

const GITHUB_API_BASE = "https://api.github.com";
const REPO_OWNER = "anomalyco";
const REPO_NAME = "agent-core";

export const fetchAgentCoreSourceTool: ToolInfo = {
  name: "fetch_agent_core_source",
  description: `Fetch source code from agent-core repository on GitHub.

Arguments:
- path: File path in repository (e.g., packages/core/src/server/environment.ts)
- commit: Optional commit hash or branch (defaults to current running version)
- language: Optional programming language for syntax highlighting
- localPath: Optional absolute path to save file locally`,

  parameters: z.object({
    path: z.string().describe("File path in the repository"),
    commit: z.string().optional().describe("Commit hash or branch name"),
    language: z.string().optional().describe("Programming language"),
    localPath: z.string().optional().describe("Absolute local path to save file"),
  }),

  async execute(args, ctx): Promise<ToolResult> {
    const { path: filePath, commit, language, localPath } = args;
    
    const env = (ctx as any).env;
    const currentCommit = env?.getCommitVersion?.() || "master";
    const targetCommit = commit || currentCommit;

    // Fetch from GitHub API...
    
    if (localPath) {
      // Save to local file
      fs.writeFileSync(localPath, content, "utf-8");
      return { success: true, output: `File saved to: ${localPath}` };
    }

    return { success: true, output: `## ${filePath}\n\n\`\`\`${language}\n${content}\n\`\`\`` };
  },
};
```

---

### 3.3 Built-in tong_work_help Skill

#### 3.3.1 Skill File Location

Built-in skill content is stored in TypeScript file:

```
packages/core/src/server/built-in-skills.ts
```

The skill content is stored as a template literal string in the `content` field of `BUILT_IN_SKILLS` array.

#### 3.3.2 Skill Content

The built-in skills contain comprehensive help content:

- **Configuration Guide**: User-level and environment-level configuration
- **Environment Mechanism**: BaseEnvironment, ServerEnvironment design
- **Skill Development**: How to create custom skills
- **Commands**: Server and built-in commands
- **Source Code Analysis**: How to use fetch_agent_core_source tool
- **Troubleshooting**: Log locations, debugging tools (search_logs, get_trace)

#### 3.3.3 Skill Usage

Users call the skill via skill tool:

```
skill(skill="tong_work_help")
```

Or ask questions naturally:
- "How do I configure MCP servers?"
- "Show me how fetch_agent_core_source works"
- "Help me understand the Environment design"

---

## 4. Implementation Steps

| Step | Description | File |
|------|-------------|------|
| 1 | Modify build.ts, inject Commit Hash | `packages/core/scripts/build.ts` |
| 2 | Extend Environment interface | `packages/core/src/core/environment/index.ts` |
| 3 | Implement getCommitVersion in BaseEnvironment | `packages/core/src/core/environment/base/base-environment.ts` |
| 4 | Create GitHub source fetching Tool | `packages/core/src/tools/github/fetch-agent-core-source.ts` |
| 5 | Register fetch_agent_core_source Tool | `packages/core/src/server/environment.ts` |
| 6 | Create tong_work_help built-in skill | `packages/core/src/server/built-in-skills.ts` |
| 7 | Update buildEnvInfo to show version | `packages/core/src/config/prompts/variables.ts` |
| 8 | Update documentation | `docs/DEVELOPMENT_PROGRESS.md` |

---

## 5. Testing

### 5.1 Build-time Verification

```bash
# Build binary
bun run build

# Check binary contains commit info
strings dist/tong_work-windows-x64/bin/tong_work.exe | grep -i "^[a-f0-9]{40}$"
```

### 5.2 Runtime Verification

```bash
# Start Server
bun run start

# Test getCommitVersion

# Test fetch_agent_core_source Tool
fetch_agent_core_source({ path: "packages/core/package.json" })

# Test tong_work_help Skill
skill(skill="tong_work_help")
```

### 5.3 End-to-End Scenarios

**Scenario 1: User Configuration Issue**
```
User: "My MCP config has issues, how should I configure?"

Agent calls tong_work_help Skill
  =>
  Returns MCP configuration guide
  =>
  Agent provides configuration suggestions
```

**Scenario 2: Developer Understanding Architecture**
```
User: "How is agent-core's Environment layering designed?"

Agent calls tong_work_help Skill(topic="environment")
  =>
  Returns Environment design explanation
  =>
  Agent explains architecture
```

**Scenario 3: Developer Viewing Source Code**
```
User: "Show me ServerEnvironment's event handling logic"

Agent calls fetch_agent_core_source Tool
  =>
  Gets packages/core/src/server/environment.ts source
  =>
  Agent explains event handling based on source
```

---

## 6. Key Files

| Function | File Path |
|----------|-----------|
| Build script | `packages/core/scripts/build.ts` |
| Environment interface | `packages/core/src/core/environment/index.ts` |
| BaseEnvironment | `packages/core/src/core/environment/base/base-environment.ts` |
| ServerEnvironment | `packages/core/src/server/environment.ts` |
| GitHub source Tool | `packages/core/src/tools/github/fetch-agent-core-source.ts` |
| Built-in skills | `packages/core/src/server/built-in-skills.ts` |
| EnvInfo builder | `packages/core/src/config/prompts/variables.ts` |

---

## 7. Notes

1. **GitHub API Rate Limit**: GitHub API has rate limits, may need authentication or caching
2. **Security**: Be careful not to expose sensitive info when fetching from GitHub
3. **Version Matching**: Ensure fetch_agent_core_source default commit matches running version
4. **tong_work vs agent-core**: This feature helps users understand the relationship between tong_work (product) and agent-core (core engine)
5. **Offline Support**: tong_work_help Skill provides offline help via static content
