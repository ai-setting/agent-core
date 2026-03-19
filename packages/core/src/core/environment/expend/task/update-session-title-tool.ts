import { z } from "zod";
import type { ToolInfo, ToolContext, ToolResult } from "../../../types/tool.js";
import type { ServerEnvironment } from "../../../../server/environment.js";
import { createLogger } from "../../../../utils/logger.js";

const logger = createLogger("session:title", "server.log");

export const UpdateSessionTitleParameters = z.object({
  session_id: z.string().describe("The session ID to update title for"),
  title: z.string().describe("The new title for the session (max 25 characters recommended)"),
  reason: z.string().describe("Brief reason for updating the title (max 30 chars, e.g., 'Update title based on task')"),
});

export type UpdateSessionTitleParams = z.infer<typeof UpdateSessionTitleParameters>;

export interface UpdateSessionTitleToolResult {
  tool: ToolInfo;
}

export function createUpdateSessionTitleTool(env: ServerEnvironment): UpdateSessionTitleToolResult {
  const tool: ToolInfo = {
    name: "update_session_title",
    description: `Update the title of a session. Use this to set a meaningful title that summarizes the conversation topic.

## When to use
- When the current session title is a default format (e.g., "New Session", "Session xxx")
- After collecting enough information about the conversation topic
- When you want to give a more descriptive title to a session

## Guidelines
- Keep the title concise (25 characters or less recommended)
- The title should summarize the main topic or user request`,
    parameters: UpdateSessionTitleParameters,
    execute: async (args: UpdateSessionTitleParams, ctx: ToolContext): Promise<ToolResult> => {
      const startTime = Date.now();
      const { session_id, title } = args;

      logger.info(`Updating session title: session_id=${session_id}, title=${title}`);

      try {
        const session = await env.getSession(session_id);
        if (!session) {
          logger.warn(`Session not found: ${session_id}`);
          return {
            success: false,
            output: "",
            error: `Session not found: ${session_id}`,
            metadata: {
              execution_time_ms: Date.now() - startTime,
            },
          };
        }

        // Update session title using env.updateSession
        if (env.updateSession) {
          env.updateSession(session_id, { title });
        } else {
          // Fallback: directly update if updateSession not available
          (session as any)._info.title = title;
        }

        logger.info(`Session title updated successfully: session_id=${session_id}, title=${title}`);

        return {
          success: true,
          output: `Session title updated to: "${title}"`,
          metadata: {
            execution_time_ms: Date.now() - startTime,
            session_id,
            title,
          },
        };
      } catch (error) {
        logger.error(`Failed to update session title: ${error instanceof Error ? error.message : String(error)}`);
        return {
          success: false,
          output: "",
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            execution_time_ms: Date.now() - startTime,
          },
        };
      }
    },
  };

  return { tool };
}
