import type { ServerEnvironment } from "../../../../server/environment.js";
import { ID } from "../../../session/id.js";
import type { Session } from "../../../session/index.js";
import type { TextPart, Part } from "../../../session/types.js";
import type { SubAgentSpec, SessionPermission } from "./types.js";
import { getSubAgentSpec } from "./agents.js";
import { buildSubAgentPermissions, getDefaultSubAgentPrompt } from "./permissions.js";

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

    const subSession = this.env.createSession({
      parentID: parentSessionId,
      title: title + ` (@${subagentType} subagent)`,
      metadata: {
        subagent_type: subagentType,
        created_by: "subagent",
        permissions,
      },
    });

    let systemPrompt = subAgent?.promptOverride || getDefaultSubAgentPrompt(title);
    if (description) {
      systemPrompt = systemPrompt.replace(/\{task_description\}/g, description);
    }
    
    const textPart: TextPart = {
      id: ID.ascending("part"),
      type: "text",
      text: systemPrompt,
    };
    subSession.addMessage({
      id: ID.ascending("message"),
      sessionID: subSession.id,
      role: "system",
      timestamp: Date.now(),
    }, [textPart as Part]);

    return subSession;
  }

  async executeSubSession(
    subSession: Session,
    taskPrompt: string,
    timeout?: number
  ): Promise<string> {
    subSession.addUserMessage(taskPrompt);

    const history = subSession.toHistory();
    const subAgent = getSubAgentSpec(subSession.info.metadata?.subagent_type as string || "general");

    try {
      const timeoutMs = timeout || subAgent?.timeout || 300000;
      
      const result = await this.executeWithTimeout(
        subSession.id,
        taskPrompt,
        history,
        timeoutMs
      );

      subSession.addAssistantMessage(result);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      subSession.addAssistantMessage(`Error: ${errorMessage}`);
      throw error;
    }
  }

  private async executeWithTimeout(
    sessionId: string,
    query: string,
    history: any[],
    timeoutMs: number
  ): Promise<string> {
    return new Promise((resolve: (value: string) => void, reject: (reason: any) => void) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task execution timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.env.handle_query(query, { session_id: sessionId }, history)
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
