/**
 * @fileoverview Session Manager
 * 
 * Manages chat sessions with persistence.
 */

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  /**
   * Create a new session
   * @param title - Optional session title
   * @param id - Optional session ID (if not provided, a new ID will be generated)
   */
  create(title?: string, id?: string): Session {
    const session: Session = {
      id: id || this.generateId(),
      title: title || "New Chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };

    this.sessions.set(session.id, session);
    console.log(`[Session] Created: ${session.id}`);
    return session;
  }

  /**
   * Get session by ID
   */
  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /**
   * List all sessions
   */
  list(): Session[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /**
   * Delete session
   */
  delete(id: string): boolean {
    const deleted = this.sessions.delete(id);
    if (deleted) {
      console.log(`[Session] Deleted: ${id}`);
    }
    return deleted;
  }

  /**
   * Add message to session
   */
  addMessage(sessionId: string, role: Message["role"], content: string): Message | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const message: Message = {
      id: this.generateId(),
      role,
      content,
      timestamp: Date.now(),
    };

    session.messages.push(message);
    session.updatedAt = Date.now();
    
    return message;
  }

  /**
   * Get session messages
   */
  getMessages(sessionId: string): Message[] {
    const session = this.sessions.get(sessionId);
    return session?.messages || [];
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
