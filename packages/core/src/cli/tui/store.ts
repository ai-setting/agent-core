/**
 * @fileoverview Reactive Store - Fixed version with array tracking
 */

type Listener = () => void;

export interface SessionStore {
  messages: any[];
  parts: Record<string, any[]>;
  sessionId?: string;
  isStreaming: boolean;
  status: string;
}

class ReactiveStore {
  private listeners: Set<Listener> = new Set();
  private batching = false;
  private pending = false;

  constructor(private store: SessionStore) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    // Execute immediately
    listener();
    return () => this.listeners.delete(listener);
  }

  private notify() {
    if (this.batching) {
      this.pending = true;
      return;
    }
    
    this.listeners.forEach((listener) => listener());
    this.pending = false;
  }

  batch(fn: () => void) {
    this.batching = true;
    fn();
    this.batching = false;
    if (this.pending) {
      this.notify();
    }
  }

  // Direct state access
  get state(): SessionStore {
    return this.store;
  }

  // Manual trigger
  trigger() {
    this.notify();
  }
}

// Create singleton store
const rawStore: SessionStore = {
  messages: [],
  parts: {},
  sessionId: undefined,
  isStreaming: false,
  status: "",
};

const reactiveStore = new ReactiveStore(rawStore);

export const store = reactiveStore.state;

// SolidJS-compatible API
export function createEffect(fn: () => void): () => void {
  return reactiveStore.subscribe(fn);
}

// Store Actions - with manual triggering
export const storeActions = {
  addMessage(message: any) {
    store.messages.push(message);
    store.parts[message.id] = [];
    reactiveStore.trigger();
  },

  updatePart(messageId: string, part: any) {
    const parts = store.parts[messageId];
    if (!parts) {
      store.parts[messageId] = [part];
    } else {
      const index = parts.findIndex((p: any) => p.id === part.id);
      if (index >= 0) {
        parts[index] = part;
      } else {
        parts.push(part);
      }
    }
    reactiveStore.trigger();
  },

  setSessionId(sessionId: string) {
    store.sessionId = sessionId;
    reactiveStore.trigger();
  },

  setStreaming(isStreaming: boolean) {
    store.isStreaming = isStreaming;
    reactiveStore.trigger();
  },

  setStatus(status: string) {
    store.status = status;
    reactiveStore.trigger();
  },

  reset() {
    store.messages = [];
    store.parts = {};
    store.sessionId = undefined;
    store.isStreaming = false;
    store.status = "";
    reactiveStore.trigger();
  },
};
