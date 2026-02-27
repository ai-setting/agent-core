/**
 * @fileoverview Active Session Manager
 * 
 * Manages the mapping between clientId and active session.
 * When an event arrives without trigger_session_id, it can fallback to active session.
 */

import { serverLogger } from "./logger.js";

export class ActiveSessionManager {
  private activeSessions = new Map<string, string>(); // clientId -> sessionId

  /**
   * Set the active session for a client
   */
  setActiveSession(clientId: string, sessionId: string): void {
    this.activeSessions.set(clientId, sessionId);
    serverLogger.info(`[ActiveSession] Client ${clientId} set active session: ${sessionId}`);
  }

  /**
   * Get the active session for a client
   */
  getActiveSession(clientId: string): string | undefined {
    return this.activeSessions.get(clientId);
  }

  /**
   * Clear the active session for a client
   */
  clearActiveSession(clientId: string): void {
    this.activeSessions.delete(clientId);
    serverLogger.info(`[ActiveSession] Client ${clientId} cleared active session`);
  }

  /**
   * Check if a client has an active session
   */
  hasActiveSession(clientId: string): boolean {
    return this.activeSessions.has(clientId);
  }

  /**
   * Get all active sessions (for debugging)
   */
  getAllActiveSessions(): Map<string, string> {
    return new Map(this.activeSessions);
  }
}
