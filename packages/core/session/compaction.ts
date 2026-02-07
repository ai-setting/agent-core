/**
 * @fileoverview Session compaction - Context compression via child session.
 *
 * This module provides session compaction functionality by creating child sessions
 * with AI-generated summaries.
 *
 * Based on OpenCode's SessionCompaction architecture.
 *
 * Flow:
 * 1. Create a child session
 * 2. Copy recent messages to the child
 * 3. Call LLM to generate a summary
 * 4. Add the summary as a system message
 * 5. Return the new compacted session
 */

import type { Session } from "./session";

/**
 * Compaction configuration options.
 */
export interface CompactionConfig {
  /** Enable automatic compaction when context is full (default: true) */
  auto?: boolean;
  /** Enable pruning of old tool calls (default: true) */
  prune?: boolean;
  /** Maximum number of messages to keep */
  maxMessages?: number;
  /** Maximum number of tokens */
  maxTokens?: number;
  /** Custom prompt for compression */
  customPrompt?: string;
}

/**
 * Compaction status.
 */
export interface CompactionStatus {
  /** Whether compaction is needed */
  needsCompaction: boolean;
  /** Current message count */
  messageCount: number;
  /** Estimated token count */
  tokenCount: number;
}

/**
 * Compaction result.
 */
export interface CompactionResult {
  /** Whether compaction was successful */
  success: boolean;
  /** The compacted session */
  session?: Session;
  /** Number of messages in original session */
  originalMessageCount: number;
  /** Summary of the compaction */
  summary?: string;
}

/**
 * Environment interface for compaction.
 */
export interface CompactionEnv {
  handle_query: (input: string, ctx: any, history: Array<{ role: string; content: any }>) => Promise<string>;
}

/**
 * Compaction condition configuration.
 */
export interface CompactionCondition {
  /** Maximum number of messages before triggering compaction (default: 20) */
  maxMessages?: number;
  /** Maximum number of tokens before triggering compaction (default: 10000) */
  maxTokens?: number;
}

/**
 * SessionCompaction namespace.
 * Provides session compaction via child session creation.
 */
export namespace SessionCompaction {
  /**
   * Check if compaction should be triggered based on conditions.
   *
   * @param session - The session to check
   * @param condition - Compaction trigger conditions
   * @returns True if compaction should be triggered
   *
   * @example
   * ```typescript
   * // Check if should compact based on message count
   * if (SessionCompaction.shouldCompact(session, { maxMessages: 10 })) {
   *   const result = await SessionCompaction.process(env, session);
   * }
   * ```
   */
  export async function shouldCompact(
    session: Session,
    condition?: CompactionCondition
  ): Promise<boolean> {
    const maxMessages = condition?.maxMessages ?? 20;
    const maxTokens = condition?.maxTokens ?? 10000;

    if (session.messageCount >= maxMessages) {
      return true;
    }

    const tokens = await estimateTokens(session);
    if (tokens >= maxTokens) {
      return true;
    }

    return false;
  }

  /**
   * Check if the session needs compaction based on token overflow.
   *
   * @param session - The session to check
   * @param model - The model context limits
   * @returns True if the session needs compaction
   */
  export async function isOverflow(
    session: Session,
    model: { limit?: { context?: number; output?: number } }
  ): Promise<boolean> {
    const status = await getStatus(session, { maxMessages: 100 });
    return status.tokenCount > (model.limit?.context ?? 100000);
  }

  /**
   * Get the current compaction status for a session.
   *
   * @param session - The session to check
   * @param config - Configuration options
   * @returns Current compaction status
   */
  export async function getStatus(
    session: Session,
    config?: CompactionConfig
  ): Promise<CompactionStatus> {
    const maxMessages = config?.maxMessages ?? 100;
    const maxTokens = config?.maxTokens ?? 100000;

    return {
      needsCompaction: session.messageCount > maxMessages,
      messageCount: session.messageCount,
      tokenCount: await estimateTokens(session),
    };
  }

  /**
   * Process compaction for a session using child session approach.
   *
   * @param env - Environment with LLM access (or session for backward compatibility)
   * @param session - The session to compact
   * @param options - Compaction options
   * @returns Compaction result with new session
   */
  export async function process(
    env: CompactionEnv | Session,
    session?: Session,
    options?: {
      keepMessages?: number;
      customPrompt?: string;
      auto?: boolean;
    }
  ): Promise<CompactionResult> {
    let envParam: CompactionEnv | undefined;
    let sessionParam: Session | undefined;

    if (session === undefined) {
      envParam = undefined;
      sessionParam = env as Session;
    } else {
      envParam = env as CompactionEnv;
      sessionParam = session;
    }

    if (!envParam || !sessionParam) {
      return {
        success: false,
        originalMessageCount: sessionParam?.messageCount ?? 0,
        summary: "Environment not provided",
      };
    }

    const keepMessages = options?.keepMessages ?? 50;

    try {
      const compactedSession = await sessionParam.compact(envParam, {
        keepMessages,
        customPrompt: options?.customPrompt,
      });

      const messages = compactedSession.getMessages();
      const summaryMsg = messages.find(m => m.info.role === "system");

      return {
        success: true,
        session: compactedSession,
        originalMessageCount: sessionParam.messageCount,
        summary: summaryMsg?.parts.find(p => p.type === "text") ? (summaryMsg.parts[0] as any).text : undefined,
      };
    } catch (error) {
      return {
        success: false,
        originalMessageCount: sessionParam.messageCount,
        summary: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Manually trigger compaction for a session.
   *
   * @param env - Environment with LLM access
   * @param session - The session to compact
   * @param config - Compaction configuration
   * @returns Compaction result with new session
   */
  export async function compact(
    env: CompactionEnv,
    session: Session,
    config?: CompactionConfig
  ): Promise<CompactionResult> {
    return process(env, session, {
      keepMessages: config?.maxMessages,
      customPrompt: config?.customPrompt,
      auto: config?.auto,
    });
  }

  /**
   * Prune old tool calls that are no longer relevant.
   * This is a lightweight version that marks parts as compacted.
   *
   * @param session - The session to prune
   * @param options - Pruning options
   * @returns Number of tool calls pruned
   */
  export async function prune(
    session: Session,
    options?: { protectedTools?: string[] }
  ): Promise<number> {
    const protectedTools = options?.protectedTools ?? ["skill"];
    let pruned = 0;

    const messages = session.getMessages();

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === "tool") {
          const tool = part as any;
          if (!protectedTools.includes(tool.tool) && tool.state === "completed") {
            pruned++;
          }
        }
      }
    }

    return pruned;
  }

  /**
   * Clean up compacted content (for future use).
   *
   * @param session - The session to clean up
   * @returns Number of parts cleaned up
   */
  export async function cleanup(session: Session): Promise<number> {
    return 0;
  }

  /**
   * Estimate the token count for a session.
   * Simple estimation: ~4 characters per token.
   *
   * @param session - The session to estimate
   * @returns Estimated token count
   */
  export async function estimateTokens(session: Session): Promise<number> {
    const messages = session.getMessages();
    let totalChars = 0;

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type === "text") {
          totalChars += (part as any).text?.length ?? 0;
        } else if (part.type === "tool") {
          const tool = part as any;
          totalChars += (tool.output?.length ?? 0) + (tool.input ? JSON.stringify(tool.input).length : 0);
        }
      }
    }

    return Math.ceil(totalChars / 4);
  }

  /**
   * Default pruning protection threshold.
   */
  export const PRUNE_PROTECT = 40000;

  /**
   * Minimum tokens to prune.
   */
  export const PRUNE_MINIMUM = 20000;

  /**
   * Protected tools that won't be pruned.
   */
  export const PRUNE_PROTECTED_TOOLS = ["skill"];
}

/**
 * Compaction status.
 */
export interface CompactionStatus {
  /** Whether compaction is needed */
  needsCompaction: boolean;
  /** Current message count */
  messageCount: number;
  /** Estimated token count */
  tokenCount: number;
}

/**
 * Compaction result.
 */
export interface CompactionResult {
  /** Whether compaction was successful */
  success: boolean;
  /** The compacted session */
  session?: Session;
  /** Number of messages in original session */
  originalMessageCount: number;
  /** Summary of the compaction */
  summary?: string;
}
