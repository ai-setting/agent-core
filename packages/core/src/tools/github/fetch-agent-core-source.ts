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

Use this tool to read the source code of agent-core at a specific commit or branch.
This is useful for understanding how the system works, debugging issues, or learning about implementation details.

Arguments:
- path: The file path to fetch (e.g., "packages/core/src/server/environment.ts")
- commit: Optional commit hash or branch name (defaults to the current running version)
- language: Optional programming language for syntax highlighting
- localPath: Optional absolute path to save the file locally. If provided, the file will be saved to this path and the content will be read from local file instead of returning inline.`,

  parameters: z.object({
    path: z.string().describe("File path in the repository (e.g., packages/core/src/server/environment.ts)"),
    commit: z.string().optional().describe("Commit hash or branch name (default: current running version)"),
    language: z.string().optional().describe("Programming language for display (typescript, javascript, python, etc.)"),
    localPath: z.string().optional().describe("Absolute local path to save the file. If provided, file will be saved here and can be read locally."),
  }),

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const { path: filePath, commit, language, localPath } = args as {
      path: string;
      commit?: string;
      language?: string;
      localPath?: string;
    };

    const env = (ctx as any).env;
    const currentCommit = env?.getCommitVersion?.() || "master";
    const targetCommit = commit || currentCommit;

    try {
      const url = `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/contents/${filePath}?ref=${targetCommit}`;

      const response = await fetch(url, {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "agent-core-tong_work",
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return {
            success: false,
            output: "",
            error: `File not found: ${filePath} at commit ${targetCommit}. Please check the file path and commit hash.`,
          };
        }
        return {
          success: false,
          output: "",
          error: `GitHub API error: ${response.status} ${response.statusText}`,
        };
      }

      const data = await response.json() as { content?: string; type?: string; name?: string; download_url?: string };

      if (data.content) {
        const content = Buffer.from(data.content, "base64").toString("utf-8");

        if (localPath) {
          const fullPath = path.isAbsolute(localPath) ? localPath : path.resolve(localPath);
          const dir = path.dirname(fullPath);

          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          fs.writeFileSync(fullPath, content, "utf-8");

          return {
            success: true,
            output: `File saved to: ${fullPath}\n\nYou can read this file locally for analysis.`,
          };
        }

        return {
          success: true,
          output: `## ${filePath} (${targetCommit})\n\n\`\`\`${language || "typescript"}\n${content}\n\`\`\``,
        };
      } else if (data.type === "dir") {
        return {
          success: true,
          output: `## Directory: ${filePath} (${targetCommit})\n\n(Directory listing not supported yet)`,
        };
      }

      return {
        success: false,
        output: "",
        error: "Unsupported response from GitHub API",
      };
    } catch (error) {
      return {
        success: false,
        output: "",
        error: `Failed to fetch source: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
