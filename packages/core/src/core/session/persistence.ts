import type { SessionInfo, MessageWithParts } from "./types";

export interface PersistenceConfig {
  mode: "memory" | "sqlite";
  path?: string;
  autoSave: boolean;
}

export interface SessionPersistence {
  initialize(config?: Partial<PersistenceConfig>): Promise<void>;

  saveSession(info: SessionInfo): Promise<void>;
  getSession(id: string): Promise<SessionInfo | undefined>;
  deleteSession(id: string): Promise<void>;
  listSessions(): Promise<SessionInfo[]>;

  saveMessage(sessionID: string, message: MessageWithParts): Promise<void>;
  getMessage(sessionID: string, messageID: string): Promise<MessageWithParts | undefined>;
  getMessages(sessionID: string): Promise<MessageWithParts[]>;
  deleteMessage(sessionID: string, messageID: string): Promise<void>;
  deleteMessages(sessionID: string): Promise<void>;

  clear(): Promise<void>;
  flush(): Promise<void>;
}
