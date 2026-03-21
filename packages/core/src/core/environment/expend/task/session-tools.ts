import { z } from "zod";
import type { ToolInfo, ToolContext, ToolResult } from "../../../types/tool.js";
import type { ServerEnvironment } from "../../../../server/environment.js";
import { createLogger } from "../../../../utils/logger.js";

const logger = createLogger("session:tools", "server.log");

// ============ Helper Functions ============

function parseTimestamp(timeStr: string): number {
  const date = new Date(timeStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp format: ${timeStr}. Expected format: YYYY-MM-DD HH:mm:ss`);
  }
  return date.getTime();
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

// ============ Session Tools Factory ============

export function createSessionTools(env: ServerEnvironment) {
  
  // ============ List Sessions Tool ============
  const listSessionsTool: ToolInfo = {
    name: "list_sessions",
    description: `List all sessions with optional filtering. Returns session ID, title, created time, updated time.`,
    parameters: z.object({
      limit: z.number().default(20).optional(),
      offset: z.number().default(0).optional(),
      query: z.string().optional(),
      reason: z.string(),
    }),
    execute: async (args: any, ctx: ToolContext): Promise<ToolResult> => {
      const startTime = Date.now();
      const { limit = 20, offset = 0, query } = args;

      try {
        if (!env.listSessions) {
          return { success: false, output: "", error: "Not supported", metadata: {} };
        }

        let sessions = env.listSessions();
        if (query) {
          const lowerQuery = query.toLowerCase();
          sessions = sessions.filter(s => s.info.title?.toLowerCase().includes(lowerQuery));
        }

        const total = sessions.length;
        sessions = sessions.slice(offset, offset + limit);

        return {
          success: true,
          output: JSON.stringify({
            sessions: sessions.map(s => ({
              id: s.info.id,
              title: s.info.title,
              createdAt: s.info.time?.created ? formatTimestamp(s.info.time.created) : "N/A",
            })),
            total,
            limit,
            offset,
          }, null, 2),
          metadata: { execution_time_ms: Date.now() - startTime },
        };
      } catch (error) {
        return { success: false, output: "", error: String(error), metadata: {} };
      }
    },
  };

  // ============ Grep Session Tool ============
  const grepSessionTool: ToolInfo = {
    name: "grep_session",
    description: `Search for keywords in a session's messages. Returns matching messages with timestamps.`,
    parameters: z.object({
      session_id: z.string(),
      query: z.string(),
      limit: z.number().default(10).optional(),
      reason: z.string(),
    }),
    execute: async (args: any, ctx: ToolContext): Promise<ToolResult> => {
      const startTime = Date.now();
      const { session_id, query, limit = 10 } = args;

      try {
        const session = await env.getSession(session_id);
        if (!session) {
          return { success: false, output: "", error: `Session not found: ${session_id}`, metadata: {} };
        }

        const messages = await session.getMessages();
        const lowerQuery = query.toLowerCase();
        const matches: any[] = [];

        for (const msg of messages) {
          for (const part of (msg.parts || [])) {
            if (part.type === "text" && (part as any).text?.toLowerCase().includes(lowerQuery)) {
              matches.push({
                messageId: msg.info.id,
                role: msg.info.role,
                content: (part as any).text.substring(0, 500),
                timestamp: formatTimestamp(msg.info.timestamp),
              });
              break;
            }
          }
          if (matches.length >= limit) break;
        }

        return {
          success: true,
          output: JSON.stringify({ matches, session_id, query, total: matches.length }, null, 2),
          metadata: { execution_time_ms: Date.now() - startTime },
        };
      } catch (error) {
        return { success: false, output: "", error: String(error), metadata: {} };
      }
    },
  };

  // ============ Read Session Tool ============
  const readSessionTool: ToolInfo = {
    name: "read_session",
    description: `Read messages from a session with optional time range filtering.`,
    parameters: z.object({
      session_id: z.string(),
      limit: z.number().default(50).optional(),
      offset: z.number().default(0).optional(),
      reason: z.string(),
    }),
    execute: async (args: any, ctx: ToolContext): Promise<ToolResult> => {
      const startTime = Date.now();
      const { session_id, limit = 50, offset = 0 } = args;

      try {
        const session = await env.getSession(session_id);
        if (!session) {
          return { success: false, output: "", error: `Session not found: ${session_id}`, metadata: {} };
        }

        const allMessages = await session.getMessages();
        const total = allMessages.length;
        const messages = allMessages.slice(offset, offset + limit);
        const outputMessages = messages.map(msg => ({
          id: msg.info.id,
          role: msg.info.role,
          content: (msg.parts || []).filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n").substring(0, 2000),
          timestamp: formatTimestamp(msg.info.timestamp),
        }));

        return {
          success: true,
          output: JSON.stringify({
            session_id,
            session_title: session.info.title,
            messages: outputMessages,
            total,
            offset,
            limit,
          }, null, 2),
          metadata: { execution_time_ms: Date.now() - startTime },
        };
      } catch (error) {
        return { success: false, output: "", error: String(error), metadata: {} };
      }
    },
  };

  return { listSessionsTool, grepSessionTool, readSessionTool };
}
