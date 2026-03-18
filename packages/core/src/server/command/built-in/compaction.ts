/**
 * @fileoverview Compaction Command - Session compaction management
 *
 * Manually trigger session compaction to compress context
 */

import type { Command, CommandContext, CommandResult } from "../types.js";
import { serverLogger } from "../../logger.js";
import { Session } from "../../../core/session/index.js";
import { Storage } from "../../../core/session/storage.js";

interface CompactionAction {
  type: "compact" | "status" | "help";
  sessionId?: string;
}

/**
 * Compaction Command - Manually trigger session compaction
 */
export const compactionCommand: Command = {
  name: "compaction",
  displayName: "Compaction",
  description: "Manage session compaction (compact, status)",
  hasArgs: true,
  argsDescription: '{"type":"compact","sessionId":"..."} or {"type":"status","sessionId":"..."}',

  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    // Parse action
    let action: CompactionAction;
    try {
      action = args ? JSON.parse(args) : { type: "help" };
    } catch {
      return {
        success: false,
        message: "Invalid arguments",
        data: { error: "Invalid JSON. Use {\"type\":\"help\"} for help." },
      };
    }

    switch (action.type) {
      case "help":
        return handleHelpAction();

      case "status":
        return await handleStatusAction(action.sessionId);

      case "compact":
        return await handleCompactAction(action.sessionId, context);

      default:
        return {
          success: false,
          message: `Unknown action: ${(action as CompactionAction).type}`,
        };
    }
  },
};

function handleHelpAction(): CommandResult {
  return {
    success: true,
    message: "Compaction Command Help",
    data: {
      help: {
        description: "Manage session compaction",
        usage: 'tong_work compaction \'{"type":"..."}\'',
        actions: {
          compact: 'Trigger compaction for a session. Usage: {"type":"compact","sessionId":"ses_xxx"}',
          status: 'Get compaction status. Usage: {"type":"status","sessionId":"ses_xxx"}',
        },
        examples: [
          'tong_work compaction \'{"type":"status","sessionId":"default"}\'',
          'tong_work compaction \'{"type":"compact","sessionId":"default"}\'',
        ],
      },
    },
  };
}

async function handleStatusAction(sessionId?: string): Promise<CommandResult> {
  if (!sessionId) {
    return {
      success: false,
      message: "sessionId is required",
      data: { error: "Please provide sessionId" },
    };
  }

  try {
    const session = Session.get(sessionId);
    if (!session) {
      return {
        success: false,
        message: "Session not found",
        data: { error: `Session ${sessionId} not found` },
      };
    }

    const stats = session.getContextStats();
    return {
      success: true,
      message: `Compaction status for session: ${sessionId}`,
      data: {
        sessionId: session.id,
        compacted: stats?.compacted ?? false,
        compactedSessionId: stats?.compactedSessionId ?? null,
        usagePercent: stats?.usagePercent ?? 0,
        contextWindow: stats?.contextWindow ?? 8192,
        requestCount: stats?.requestCount ?? 0,
      },
    };
  } catch (err) {
    serverLogger.error("[Compaction] Error getting status:", err);
    return {
      success: false,
      message: "Error getting status",
      data: { error: String(err) },
    };
  }
}

async function handleCompactAction(sessionId?: string, context?: CommandContext): Promise<CommandResult> {
  if (!sessionId) {
    return {
      success: false,
      message: "sessionId is required",
      data: { error: "Please provide sessionId" },
    };
  }

  try {
    const session = Session.get(sessionId);
    if (!session) {
      return {
        success: false,
        message: "Session not found",
        data: { error: `Session ${sessionId} not found` },
      };
    }

    // Check if already compacted
    const stats = session.getContextStats();
    if (stats?.compacted) {
      return {
        success: true,
        message: "Session already compacted",
        data: {
          sessionId: session.id,
          compacted: true,
          compactedSessionId: stats.compactedSessionId,
        },
      };
    }

    // If env is available, use it to trigger compaction
    if (context?.env) {
      try {
        // Manually trigger updateContextUsage with high usage to trigger compaction
        // This simulates the automatic trigger that happens in invokeLLM
        await session.updateContextUsage(
          {
            inputTokens: 85000,
            outputTokens: 15000,
            totalTokens: 100000,
          },
          100000, // context window
          context.env, // pass env for compaction
          "gpt-4o" // model ID
        );

        const newStats = session.getContextStats();
        return {
          success: true,
          message: "Compaction triggered successfully",
          data: {
            originalSessionId: session.id,
            compactedSessionId: newStats?.compactedSessionId,
            compacted: newStats?.compacted ?? false,
          },
        };
      } catch (err) {
        serverLogger.error("[Compaction] Error triggering compaction:", err);
        return {
          success: false,
          message: "Error triggering compaction",
          data: { error: String(err) },
        };
      }
    }

    // No env available, return info
    return {
      success: true,
      message: "Env not available, use tong_work run to trigger compaction",
      data: {
        sessionId: session.id,
        message: "Start a run with tong_work run to interact and trigger compaction when usage exceeds threshold",
        currentUsage: {
          usagePercent: stats?.usagePercent ?? 0,
          requestCount: stats?.requestCount ?? 0,
        },
      },
    };
  } catch (err) {
    serverLogger.error("[Compaction] Error:", err);
    return {
      success: false,
      message: "Error",
      data: { error: String(err) },
    };
  }
}
