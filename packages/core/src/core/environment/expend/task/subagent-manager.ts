import type { ServerEnvironment } from "../../../../server/environment.js";
import { ID } from "../../../session/id.js";
import type { Session } from "../../../session/index.js";
import type { TextPart, Part } from "../../../session/types.js";
import type { SubAgentSpec, SessionPermission } from "./types.js";
import { getSubAgentSpec } from "./agents.js";
import { buildSubAgentPermissions, getDefaultSubAgentPrompt } from "./permissions.js";
import type { ModelMessage } from "ai";

export interface CreateSubSessionOptions {
  parentSessionId: string;
  title: string;
  subagentType: string;
  description?: string;
  permission?: SessionPermission[];
}

export class SubAgentManager {
  constructor(private env: ServerEnvironment) {}

  async createSubSession(options: CreateSubSessionOptions): Promise<Session> {
    const { parentSessionId, title, subagentType, description } = options;

    const parentSession = this.env.getSession(parentSessionId);
    if (!parentSession) {
      throw new Error(`Parent session not found: ${parentSessionId}`);
    }

    const subAgent = getSubAgentSpec(subagentType);
    const permissions = buildSubAgentPermissions(subAgent, {
      extraPermissions: options.permission,
    });

    // Store description in metadata for behavior spec injection
    const metadata = {
      subagent_type: subagentType,
      created_by: "subagent",
      permissions,
    };
    if (description) {
      (metadata as any).task_description = description;
    }

    const subSession = this.env.createSession({
      parentID: parentSessionId,
      title: title + ` (@${subagentType} subagent)`,
      metadata,
    });

    // Note: system prompt is NOT added here
    // It will be injected by Agent.run() based on agentType in context

    return subSession;
  }

  async executeSubSession(
    subSession: Session,
    taskPrompt: string,
    timeout?: number
  ): Promise<string> {
    const subAgent = getSubAgentSpec(subSession.info.metadata?.subagent_type as string || "general");
    const history = subSession.toHistory();

    try {
      const timeoutMs = timeout || subAgent?.timeout || 300000;
      
      const result = await this.executeWithTimeout(
        subSession.id,
        taskPrompt,
        history,
        timeoutMs,
        subSession
      );

      subSession.addMessageFromModelMessage({
        role: "assistant",
        content: result,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      subSession.addMessageFromModelMessage({
        role: "assistant",
        content: `Error: ${errorMessage}`,
      });
      throw error;
    }
  }

  private async executeWithTimeout(
    sessionId: string,
    query: string,
    history: any[],
    timeoutMs: number,
    subSession: Session
  ): Promise<string> {
    return new Promise((resolve: (value: string) => void, reject: (reason: any) => void) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const agentType = subSession.info.metadata?.subagent_type as string || "general";

      this.env.handle_query(query, { 
        session_id: sessionId,
        agentType,
        onMessageAdded: (message: ModelMessage) => {
          subSession.addMessageFromModelMessage(message);
        }
      }, history)
        .then((result: string) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error: any) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  getSubAgentSpec(id: string): SubAgentSpec | undefined {
    return getSubAgentSpec(id);
  }

  listSubAgents(): SubAgentSpec[] {
    const { listSubAgents } = require("./agents.js");
    return listSubAgents();
  }
}
