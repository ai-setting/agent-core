/**
 * @fileoverview Session module - Main entry point.
 *
 * Session management module with support for:
 * - Session creation and lifecycle management
 * - Message storage and retrieval
 * - Parent-child session relationships
 * - Conversion to Agent Core history format
 * - OpenCode-compatible ID format
 *
 * @example
 * ```typescript
 * import { Session } from "./session";
 *
 * // Create a session
 * const session = Session.create({
 *   title: "My Chat",
 *   directory: "/home/user/project",
 * });
 *
 * // Add messages
 * session.addUserMessage("Hello, world!");
 * session.addAssistantMessage("Hi there!");
 *
 * // Convert to history for Agent Core
 * const history = session.toHistory();
 *
 * // Use with env.handle_query(..., history);
 * ```
 */

export { Session } from "./session";
export type { SessionInfo, MessageInfo, Part, MessageWithParts, HistoryMessage, SessionCreateOptions } from "./types";
export { ID } from "./id";
export { Storage } from "./storage";
export { SessionCompaction, type CompactionConfig, type CompactionStatus, type CompactionResult, type CompactionEnv, type CompactionCondition } from "./compaction";
export {
  sessionToHistory,
  filterMessages,
  getRecentHistory,
  hasCompactedContent,
} from "./history";

// Re-export commonly used types
import type { Role } from "./types";

export type { Role };
export type { CompactionOptions } from "./session";
