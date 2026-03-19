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
  taskId?: number;  // 关联的任务ID，用于操作记录追溯
}

export class SubAgentManager {
  constructor(private env: ServerEnvironment) {}

  async createSubSession(options: CreateSubSessionOptions): Promise<Session> {
    const { parentSessionId, title, subagentType, description, taskId } = options;

    const parentSession = this.env.getSession(parentSessionId);
    if (!parentSession) {
      throw new Error(`Parent session not found: ${parentSessionId}`);
    }

    const subAgent = getSubAgentSpec(subagentType);
    const permissions = buildSubAgentPermissions(subAgent, {
      extraPermissions: options.permission,
    });

    // Store task info in metadata for behavior spec injection and operation tracking
    const metadata: Record<string, unknown> = {
      subagent_type: subagentType,
      created_by: "subagent",
      permissions,
    };
    if (description) {
      metadata.task_description = description;
    }
    if (taskId) {
      metadata.task_id = taskId;
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
    const history = await subSession.toHistory();

    // 构建完整的 system prompt（包含占位符替换和执行规范注入）
    const fullPrompt = this.buildFullPrompt(subSession, taskPrompt);

    try {
      const timeoutMs = timeout || subAgent?.timeout || 300000;
      
      const result = await this.executeWithTimeout(
        subSession.id,
        fullPrompt,  // 使用完整的 prompt
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

  /**
   * 构建完整的 sub-agent prompt，包含占位符替换和执行规范
   */
  private buildFullPrompt(subSession: Session, taskPrompt: string): string {
    const metadata = subSession.info.metadata || {};
    const taskId = metadata.task_id as number | undefined;
    const taskDescription = metadata.task_description as string || "";
    const sessionId = subSession.id;
    const subagentType = metadata.subagent_type as string || "general";

    // 获取 subagent 的基础 promptOverride
    const subAgent = getSubAgentSpec(subagentType);
    const basePrompt = subAgent?.promptOverride || getDefaultSubAgentPrompt(taskDescription);

    // 替换占位符
    let replacedPrompt = basePrompt
      .replace(/{task_id}/g, taskId ? String(taskId) : "N/A")
      .replace(/{task_description}/g, taskDescription || "N/A")
      .replace(/{session_id}/g, sessionId);

    // 构建任务信息块
    const taskContextBlock = `

---

# 任务信息
- task_id: ${taskId || "N/A"}
- task_description: ${taskDescription}
- session_id: ${sessionId}`;

    // 构建执行规范
    const executionGuidelines = `

---

## 执行规范

### Session Title 规范
- 每个 session 都应该有简洁有意义标题来表征对话主题
- 如果当前 session title 是默认格式（如"New Session"、"Session xxx"），说明尚未生成有意义标题
- 在收集到足够信息后，应调用 update_session_title 工具生成一个 25 字以内的简洁标题

### 操作记录规范
- 适时调用 task_operation_create 记录关键进展
- 调用时 action_data 中需要包含 task_id，便于追溯
- 推荐记录时机：
  - 任务开始时
  - 重要里程碑达成时
  - 遇到问题时
  - 任务完成时`;

    // 完整拼接
    return `${replacedPrompt}${taskContextBlock}

---

## 用户指令
${taskPrompt}${executionGuidelines}`;
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
