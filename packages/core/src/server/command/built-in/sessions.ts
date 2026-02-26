/**
 * @fileoverview Sessions Command - Session list and management
 *
 * Manages session listing, selection, and deletion
 * Integrates with Storage and ServerEnvironment
 */

import type { Command, CommandContext, CommandResult } from "../types.js";
import { serverLogger } from "../../logger.js";
import { Storage } from "../../../core/session/storage.js";
import { Session } from "../../../core/session/index.js";

interface SessionsAction {
  type: "list" | "select" | "delete";
  sessionId?: string;
}

interface SessionListItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  directory: string;
}

interface SessionsResponse {
  mode: "dialog";
  sessions: SessionListItem[];
}

/**
 * Sessions Command - List and manage sessions
 */
export const sessionsCommand: Command = {
  name: "sessions",
  displayName: "Sessions",
  description: "List and manage conversation sessions",
  hasArgs: false,

  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    // Parse action
    let action: SessionsAction;
    try {
      action = args ? JSON.parse(args) : { type: "list" };
    } catch {
      return {
        success: false,
        message: "Invalid arguments",
        data: { error: "Invalid JSON" },
      };
    }

    switch (action.type) {
      case "list": {
        return await handleListAction();
      }

      case "select": {
        return await handleSelectAction(context, action);
      }

      case "delete": {
        return await handleDeleteAction(action);
      }

      default:
        return {
          success: false,
          message: `Unknown action: ${(action as SessionsAction).type}`,
        };
    }
  },
};

/**
 * Handle list action - return all sessions
 */
async function handleListAction(): Promise<CommandResult> {
  // Get all sessions from storage
  const sessions = Storage.listSessions();

  serverLogger.info("[SessionsCommand] Loading sessions", {
    count: sessions.length,
  });

  // Build session list items
  const sessionItems: SessionListItem[] = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    messageCount: session.messageCount,
    directory: session.directory,
  }));

  // Sort by updatedAt desc (most recent first)
  sessionItems.sort((a, b) => b.updatedAt - a.updatedAt);

  serverLogger.info("[SessionsCommand] Returning sessions", {
    count: sessionItems.length,
  });

  return {
    success: true,
    message: "Opening sessions dialog",
    data: {
      mode: "dialog",
      sessions: sessionItems,
    } as SessionsResponse,
  };
}

/**
 * Handle select action - switch to a session
 */
async function handleSelectAction(
  context: CommandContext,
  action: SessionsAction
): Promise<CommandResult> {
  if (!action.sessionId) {
    return {
      success: false,
      message: "Missing sessionId",
      data: { error: "Invalid selection" },
    };
  }

  // Get session
  const session = Storage.getSession(action.sessionId);
  if (!session) {
    return {
      success: false,
      message: `Session not found: ${action.sessionId}`,
      data: { error: "Session not found" },
    };
  }

  serverLogger.info("[SessionsCommand] Selecting session", {
    sessionId: action.sessionId,
  });

  // Load messages for this session on demand
  await Storage.loadSessionMessages(action.sessionId);
  serverLogger.info("[SessionsCommand] Loaded messages for session", {
    sessionId: action.sessionId,
  });

  // If env supports session switching, call it
  let switched = false;
  if (context.env && "setCurrentSession" in context.env) {
    try {
      await (context.env as any).setCurrentSession(action.sessionId);
      switched = true;
      serverLogger.info("[SessionsCommand] Session switched", {
        sessionId: action.sessionId,
      });
    } catch (error) {
      serverLogger.error("[SessionsCommand] Failed to switch session", {
        error: String(error),
      });
    }
  }

  if (!switched) {
    // If env doesn't support switching, just return success
    // The TUI can handle the session switch locally
    serverLogger.info("[SessionsCommand] Session switch not supported by env, returning success");
  }

  return {
    success: true,
    message: `Session selected: ${session.title}`,
    data: {
      sessionId: action.sessionId,
      title: session.title,
      switched,
    },
  };
}

/**
 * Handle delete action - delete a session
 */
async function handleDeleteAction(action: SessionsAction): Promise<CommandResult> {
  if (!action.sessionId) {
    return {
      success: false,
      message: "Missing sessionId",
      data: { error: "Invalid delete request" },
    };
  }

  // Get session
  const session = Session.get(action.sessionId);
  if (!session) {
    return {
      success: false,
      message: `Session not found: ${action.sessionId}`,
      data: { error: "Session not found" },
    };
  }

  serverLogger.info("[SessionsCommand] Deleting session", {
    sessionId: action.sessionId,
    title: session.title,
  });

  try {
    session.delete();
    serverLogger.info("[SessionsCommand] Session deleted", {
      sessionId: action.sessionId,
    });

    return {
      success: true,
      message: "Session deleted",
      data: { sessionId: action.sessionId },
    };
  } catch (error) {
    serverLogger.error("[SessionsCommand] Failed to delete session", {
      error: String(error),
    });

    return {
      success: false,
      message: `Failed to delete session: ${error}`,
      data: { error: String(error) },
    };
  }
}
