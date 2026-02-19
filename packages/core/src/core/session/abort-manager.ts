/**
 * @fileoverview Session Abort Manager
 *
 * Manages AbortController for each session to support interrupt functionality.
 */

export class SessionAbortManager {
  private controllers = new Map<string, AbortController>();

  create(sessionId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    return controller;
  }

  abort(sessionId: string): void {
    const controller = this.controllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.controllers.delete(sessionId);
    }
  }

  get(sessionId: string): AbortSignal | undefined {
    return this.controllers.get(sessionId)?.signal;
  }

  has(sessionId: string): boolean {
    return this.controllers.has(sessionId);
  }

  remove(sessionId: string): void {
    this.controllers.delete(sessionId);
  }
}

export const sessionAbortManager = new SessionAbortManager();
