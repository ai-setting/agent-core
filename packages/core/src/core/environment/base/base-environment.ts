/**
 * @fileoverview Base environment implementation with LLM integration.
 * Provides core functionality for agent environments.
 */

import { z } from "zod";
import path from "path";
import {
  Environment,
  Prompt,
  StreamEvent,
  type EnvironmentProfile,
  type EnvironmentAgentSpec,
  type SkillInfo,
  type BehaviorSpec,
} from "../index.js";
import type { ModelMessage } from "ai";
import { createLogger } from "../../../utils/logger.js";
import { Traced } from "../../../utils/wrap-function.js";
import {
  Context,
  Action,
  ToolResult,
  Tool,
  ToolInfo,
  LLMStream,
  LLMStreamEvent,
  StreamHandler,
  ToolContext,
} from "../../types/index.js";
import { Agent } from "../../agent/index.js";

declare const TONG_WORK_COMMIT: string;
import {
  TimeoutManager,
  RetryManager,
  ConcurrencyManager,
  ErrorRecovery,
  DefaultMetricsCollector,
  AggregatedMetrics,
} from "./index.js";
import { 
  invokeLLM, 
  intuitiveReasoning, 
  type InvokeLLMConfig, 
  type LLMOptions, 
  type LLMOutput,
  type StreamEventHandler 
} from "./invoke-llm.js";
import { Session } from "../../session/index.js";
import { sessionAbortManager } from "../../session/abort-manager.js";
import type { SessionCreateOptions } from "../../session/types.js";
import { withEventHook, withEventHookVoid } from "./with-event-hook.js";
import { SandboxProviderFactory } from "../../sandbox/sandbox-factory.js";
import type { ISandboxProvider, SandboxConfig } from "../../sandbox/types.js";

/** Session lifecycle events for subscribers */
export type SessionEvent =
  | { type: "session.created"; sessionId: string; title: string; directory?: string }
  | { type: "session.updated"; sessionId: string; updates: Record<string, unknown> }
  | { type: "session.deleted"; sessionId: string };

export interface BaseEnvironmentConfig {
  timeoutManager?: TimeoutManager;
  retryManager?: RetryManager;
  concurrencyManager?: ConcurrencyManager;
  errorRecovery?: ErrorRecovery;
  metricsCollector?: DefaultMetricsCollector;
  maxConcurrentStreams?: number;
  defaultTimeoutMs?: number;
  defaultConcurrencyLimit?: number;
  defaultMaxRetries?: number;
  defaultModel?: string;
  systemPrompt?: string;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  /**
   * Hook for handling stream events from LLM
   * Called during invoke_llm streaming response
   */
  onStreamEvent?: (event: StreamEvent, context: Context) => void | Promise<void>;
  /**
   * Hook for session lifecycle events (created, updated, deleted)
   * Called when session operations complete
   */
  onSessionEvent?: (event: SessionEvent) => void | Promise<void>;
}

export interface ToolRegistration {
  tool: Tool;
  isNew: boolean;
}

export abstract class BaseEnvironment implements Environment {
  private static baseLogger = createLogger("base:environment", "server.log");
  protected tools: Map<string, Tool> = new Map();
  protected toolCategories: Map<string, Set<string>> = new Map();
  protected prompts: Map<string, Prompt> = new Map();
  protected streams: Map<string, LLMStream> = new Map();
  protected streamHandlers: Set<StreamHandler> = new Set();
  protected timeoutManager: TimeoutManager;
  protected retryManager: RetryManager;
  protected concurrencyManager: ConcurrencyManager;
  protected errorRecovery: ErrorRecovery;
  protected metrics: DefaultMetricsCollector;
  protected maxConcurrentStreams: number;
  protected defaultModel: string;
  protected systemPrompt: string;
  protected skills: Map<string, SkillInfo> = new Map();
  protected skillsLoaded: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  private modelToInitialize: string | undefined;
  private baseURLToInitialize: string | undefined;
  private apiKeyToInitialize: string | undefined;

  protected envRules: string | null = null;
  protected agentPrompts: Map<string, string> = new Map();
  protected agentSpecs: Map<string, EnvironmentAgentSpec> = new Map();

  protected sandboxConfig: SandboxConfig | undefined = undefined;
  protected sandboxProvider: ISandboxProvider | null = null;

  constructor(config?: BaseEnvironmentConfig) {
    this.timeoutManager = config?.timeoutManager ?? TimeoutManager.default();
    this.retryManager = config?.retryManager ?? RetryManager.default();
    this.concurrencyManager = config?.concurrencyManager ?? ConcurrencyManager.default();
    this.errorRecovery = config?.errorRecovery ?? ErrorRecovery.default();
    this.metrics = config?.metricsCollector ?? new DefaultMetricsCollector();
    this.maxConcurrentStreams = config?.maxConcurrentStreams ?? 10;
    this.defaultModel = config?.defaultModel ?? "gpt-4";
    this.systemPrompt = config?.systemPrompt ?? "";

    // Set stream event hook from config
    if (config?.onStreamEvent) {
      this.onStreamEvent = config.onStreamEvent;
    }
    // Set session event hook from config
    if (config?.onSessionEvent) {
      this.onSessionEvent = config.onSessionEvent;
    }

    if (this.systemPrompt) {
      this.addPrompt({ id: "system", content: this.systemPrompt });
    }

    if (config?.model) {
      this.modelToInitialize = config.model;
      this.baseURLToInitialize = config.baseURL;
      this.apiKeyToInitialize = config.apiKey;
      this.initializationPromise = this.initializeLLM();
    }
  }

  private async initializeLLM(): Promise<void> {
    if (this.modelToInitialize) {
      await this.configureLLMWithModel(this.modelToInitialize, this.baseURLToInitialize, this.apiKeyToInitialize);
    }
  }

  protected async ensureLLMInitialized(): Promise<void> {
    if (this.initializationPromise) {
      await this.initializationPromise;
      this.initializationPromise = null;
    }
  }

  protected async configureLLMWithModel(model: string, baseURL?: string, apiKey?: string): Promise<void> {
    const { createLLMConfigFromEnv, createLLMConfig } = await import("./invoke-llm.js");
    
    // If baseURL and apiKey are provided, use them directly
    if (baseURL && apiKey) {
      const config = createLLMConfig(model, baseURL, apiKey);
      this.configureLLM(config);
      return;
    }
    
    // Otherwise, try to load from environment variables
    const config = createLLMConfigFromEnv(model);
    if (config) {
      this.configureLLM(config);
    }
  }

  registerTool(tool: Tool | ToolInfo): ToolRegistration {
    const toolInfo = "execute" in tool ? tool : this.toolToToolInfo(tool);
    const name = toolInfo.name;
    const existing = this.tools.has(name);

    this.tools.set(name, toolInfo);

    return {
      tool: toolInfo,
      isNew: !existing,
    };
  }

  unregisterTool(name: string): boolean {
    const removed = this.tools.delete(name);

    for (const [category, tools] of this.toolCategories) {
      tools.delete(name);
      if (tools.size === 0) {
        this.toolCategories.delete(category);
      }
    }

    return removed;
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  findTools(category: string): Tool[] {
    const toolNames = this.toolCategories.get(category);
    if (!toolNames) return [];
    return Array.from(toolNames)
      .map((name) => this.tools.get(name))
      .filter((t): t is Tool => t !== undefined);
  }

  listTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  getPrompt(promptId: string): Prompt | undefined {
    return this.prompts.get(promptId);
  }

  getTools(): Tool[] {
    return this.listTools();
  }

  listSkills(): SkillInfo[] {
    return Array.from(this.skills.values());
  }

  getSkill(id: string): SkillInfo | undefined {
    return this.skills.get(id);
  }

  getSkillsInfoForToolDescription(): string {
    return this.listSkills()
      .map(s => `- ${s.name}: ${s.description}`)
      .join("\n");
  }

  getCommitVersion(): string {
    if (typeof TONG_WORK_COMMIT !== "undefined") {
      return TONG_WORK_COMMIT;
    }
    return "unknown";
  }

  /**
   * 默认实现：从 getPrompt("system") 与 listTools() 推导单一默认 profile，
   * 供 env_spec 做 describeEnv/listProfiles/listAgents/getAgent 推导。子类可覆盖。
   */
  getProfiles(): EnvironmentProfile[] {
    const toolNames = this.listTools().map((t) => t.name);
    const hasSystemPrompt = !!this.getPrompt("system");
    const primaryAgent: EnvironmentAgentSpec = {
      id: "default",
      role: "primary",
      promptId: hasSystemPrompt ? "system" : undefined,
      allowedTools: toolNames,
    };
    return [
      {
        id: "default",
        displayName: "Default Profile",
        primaryAgents: [primaryAgent],
      },
    ];
  }

  /**
   * 获取指定 agent 的完整行为规范
   * 组合：环境级规则 + agent 特定 prompt
   */
  async getBehaviorSpec(agentId: string = "system"): Promise<BehaviorSpec> {
    if (this.envRules === null) {
      await this.loadBehaviorSpec();
    }

    const agentSpec = this.agentSpecs.get(agentId);
    const agentPrompt = this.agentPrompts.get(agentId) || "";

    const combinedPrompt = this.combinePrompts(
      this.envRules || "",
      agentPrompt,
      agentId
    );

    return {
      envName: this.getEnvName(),
      agentId,
      agentRole: agentSpec?.role || "primary",
      envRules: this.envRules || "",
      agentPrompt,
      combinedPrompt,
      allowedTools: agentSpec?.allowedTools,
      deniedTools: agentSpec?.deniedTools,
      metadata: {
        lastUpdated: new Date().toISOString(),
      },
    };
  }

  /**
   * 获取环境级规则（所有 agent 共享）
   */
  async getEnvRules(): Promise<string> {
    if (this.envRules === null) {
      await this.loadBehaviorSpec();
    }
    return this.envRules || "";
  }

  /**
   * 刷新行为规范（从文件重新加载）
   */
  async refreshBehaviorSpec(): Promise<void> {
    this.envRules = null;
    this.agentPrompts.clear();
    this.agentSpecs.clear();
    await this.loadBehaviorSpec();
  }

  /**
   * 根据权限过滤工具列表
   */
  filterToolsByPermission(tools: Tool[], agentId?: string): Tool[] {
    const agentSpec = agentId ? this.agentSpecs.get(agentId) : undefined;
    return this.filterToolsByAgentSpec(tools, agentSpec);
  }

  /**
   * 根据权限过滤工具列表（内部方法）
   */
  protected filterToolsByAgentSpec(
    tools: Tool[],
    agentSpec?: EnvironmentAgentSpec
  ): Tool[] {
    let filtered = tools;

    if (agentSpec?.allowedTools) {
      const allowed = new Set(agentSpec.allowedTools);
      filtered = filtered.filter((t) => allowed.has(t.name));
    }

    if (agentSpec?.deniedTools) {
      const denied = new Set(agentSpec.deniedTools);
      filtered = filtered.filter((t) => !denied.has(t.name));
    }

    return filtered;
  }

  /**
   * 加载行为规范
   */
  protected async loadBehaviorSpec(): Promise<void> {
    await this.loadEnvRules();
    await this.loadAgentPrompts();
    await this.loadAgentSpecs();
  }

  /**
   * 加载环境级规则（rules.md）
   */
  protected async loadEnvRules(): Promise<void> {
    const rulesPath = this.getRulesFilePath();

    if (!rulesPath) {
      this.envRules = this.getDefaultEnvRules();
      return;
    }

    try {
      const fs = await import("fs/promises");
      this.envRules = await fs.readFile(rulesPath, "utf-8");
    } catch {
      this.envRules = this.getDefaultEnvRules();
    }
  }

  /**
   * 加载 agent prompts
   */
  protected async loadAgentPrompts(): Promise<void> {
    const promptsDir = this.getPromptsDirectory();
    if (!promptsDir) return;

    try {
      const fs = await import("fs/promises");
      const files = await fs.readdir(promptsDir);

      for (const file of files) {
        if (!file.endsWith(".prompt")) continue;

        const filePath = path.join(promptsDir, file);
        const content = await fs.readFile(filePath, "utf-8");

        // Parse frontmatter
        const parsedContent = this.parsePromptContent(content);
        const id = path.basename(file, ".prompt");

        this.agentPrompts.set(id, parsedContent);
      }
    } catch {
      // prompts 目录不存在
    }
  }

  /**
   * 解析 prompt 内容（去除 frontmatter）
   */
  protected parsePromptContent(content: string): string {
    const lines = content.split("\n");

    if (lines[0]?.trim() !== "---") {
      return content.trim();
    }

    let endIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i]?.trim() === "---") {
        endIndex = i;
        break;
      }
    }

    if (endIndex === -1) {
      return content.trim();
    }

    return lines.slice(endIndex + 1).join("\n").trim();
  }

  /**
   * 加载 agent specs（从 profile 配置）
   */
  protected async loadAgentSpecs(): Promise<void> {
    const profiles = this.getProfiles();
    const profile = profiles[0];

    if (profile) {
      for (const agent of profile.primaryAgents) {
        this.agentSpecs.set(agent.id, agent);

        if (agent.promptOverride) {
          this.agentPrompts.set(agent.id, agent.promptOverride);
        }
      }

      for (const agent of profile.subAgents || []) {
        this.agentSpecs.set(agent.id, agent);

        if (agent.promptOverride) {
          this.agentPrompts.set(agent.id, agent.promptOverride);
        }
      }
    }
  }

  /**
   * 组合 prompt（环境规则 + agent prompt）
   */
  protected combinePrompts(
    envRules: string,
    agentPrompt: string,
    agentId: string
  ): string {
    const parts: string[] = [];

    parts.push(`# Environment: ${this.getEnvName()}`);
    parts.push(`# Agent: ${agentId}`);
    parts.push(`Working directory: ${process.cwd()}`);
    parts.push(`Today: ${new Date().toISOString().split("T")[0]}`);
    parts.push("");

    if (envRules) {
      parts.push("---");
      parts.push("# Environment Behavior Guidelines");
      parts.push("");
      parts.push(envRules);
      parts.push("");
    }

    if (agentPrompt) {
      parts.push("---");
      parts.push(`# Agent: ${agentId}`);
      parts.push("");
      parts.push(agentPrompt);
    }

    return parts.join("\n");
  }

  /**
   * 默认环境规则
   */
  protected getDefaultEnvRules(): string {
    return [
      "# Default Environment Guidelines",
      "",
      "## Safety",
      "- Do not expose sensitive information",
      "- Validate inputs before processing",
      "- Ask for confirmation on destructive operations",
      "",
      "## Communication",
      "- Be helpful and accurate",
      "- Explain your reasoning",
      "- Summarize after completing tasks",
    ].join("\n");
  }

  /**
   * 获取 rules.md 文件路径（子类实现）
   */
  protected getRulesFilePath(): string | undefined {
    return undefined;
  }

  /**
   * 获取 prompts 目录路径（子类实现）
   */
  protected getPromptsDirectory(): string | undefined {
    return undefined;
  }

  /**
   * 获取环境名称（子类实现）
   */
  protected getEnvName(): string {
    return "default";
  }

  /**
   * Session 管理：委托给 core/session 的 Session 与 Storage。
   * 子类可覆盖以使用其他 session 实现（如持久化存储）。
   * 通过 withEventHook 注入 session 生命周期事件，供 onSessionEvent 订阅。
   */
  createSession = withEventHook(
    (options?: SessionCreateOptions) => Session.create(options),
    {
      after: (self, session) => {
        self.emitSessionEvent?.({
          type: "session.created",
          sessionId: session.id,
          title: session.title,
          directory: session.directory,
        });
      },
    }
  );

  getSession(id: string): Session | undefined {
    return Session.get(id);
  }

  listSessions(): Session[] {
    return Session.list();
  }

  async listSessionInfos(
    filter?: {
      metadata?: Record<string, unknown>;
      timeRange?: { start?: number; end?: number };
    },
    options?: { offset?: number; limit?: number }
  ): Promise<{
    total: number;
    sessions: Array<{
      id: string;
      title: string;
      metadata?: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    }>;
  }> {
    const { Storage } = await import("../../session/storage.js");
    const result = Storage.listSessionInfos(filter, options);
    
    return {
      total: result.total,
      sessions: result.sessions.map(s => ({
        id: s.id,
        title: s.title,
        metadata: s.metadata,
        created_at: s.time?.created ? new Date(s.time.created).toISOString() : "",
        updated_at: s.time?.updated ? new Date(s.time.updated).toISOString() : "",
      })),
    };
  }

  async findSessionsByMetadata(metadata: Record<string, unknown>): Promise<string[]> {
    const { Storage } = await import("../../session/storage.js");
    return Storage.findSessionIdsByMetadata(metadata);
  }

  async getSessionMessages(
    sessionId: string,
    options?: { offset?: number; limit?: number }
  ): Promise<{
    total: number;
    messages: Array<{
      id: string;
      role: string;
      content: string;
      timestamp: string;
    }>;
  }> {
    const { Storage } = await import("../../session/storage.js");
    const result = Storage.getSessionMessages(sessionId, options);
    
    return {
      total: result.total,
      messages: result.messages.map(m => {
        // Extract text content from parts
        let content = "";
        if (m.parts) {
          const textPart = m.parts.find(p => p.type === "text");
          if (textPart && "text" in textPart) {
            content = textPart.text;
          } else {
            content = JSON.stringify(m.parts);
          }
        }
        return {
          id: m.info.id,
          role: m.info.role,
          content,
          timestamp: m.info.timestamp ? new Date(m.info.timestamp).toISOString() : "",
        };
      }),
    };
  }

  updateSession = withEventHookVoid(
    (id: string, payload: { title?: string; metadata?: Record<string, unknown> }): boolean => {
      const s = Session.get(id);
      if (s) {
        if (payload.title !== undefined) s.setTitle(payload.title);
        if (payload.metadata) for (const [k, v] of Object.entries(payload.metadata)) s.setMetadata(k, v);
        return true;
      }
      return false;
    },
    {
      after: (self, updated, id, payload) => {
        if (updated) {
          self.emitSessionEvent?.({
            type: "session.updated",
            sessionId: id,
            updates: payload as Record<string, unknown>,
          });
        }
      },
    }
  );

  deleteSession = withEventHookVoid(
    (id: string): { deleted: boolean; sessionId: string } => {
      const s = Session.get(id);
      if (s) {
        s.delete();
        return { deleted: true, sessionId: id };
      }
      return { deleted: false, sessionId: id };
    },
    {
      after: (self, result) => {
        if (result.deleted) {
          self.emitSessionEvent?.({
            type: "session.deleted",
            sessionId: result.sessionId,
          });
        }
      },
    }
  );

  addPrompt(prompt: Prompt): void {
    this.prompts.set(prompt.id, prompt);
  }

  loadPromptsFromConfig(loadedPrompts: { id: string; content: string }[]): void {
    for (const prompt of loadedPrompts) {
      this.prompts.set(prompt.id, {
        id: prompt.id,
        content: prompt.content,
      });
    }
  }

  subscribe(handler: StreamHandler): void {
    this.streamHandlers.add(handler);
  }

  unsubscribe(handler: StreamHandler): void {
    this.streamHandlers.delete(handler);
  }

  getStream(streamId: string): LLMStream | undefined {
    return this.streams.get(streamId);
  }

  pushToSubscribers(event: LLMStreamEvent): void {
    for (const handler of this.streamHandlers) {
      try {
        handler(event);
      } catch {
        // Ignore handler errors
      }
    }
  }

  protected createLLMStream(streamId: string): LLMStream {
    const queue: LLMStreamEvent[] = [];
    let resolver: (() => void) | null = null;
    let closed = false;

    const stream: LLMStream = {
      id: streamId,
      events: (async function* (): AsyncGenerator<LLMStreamEvent, void, unknown> {
        while (true) {
          while (queue.length > 0) {
            const event = queue.shift()!;
            if (event.type === "completed" || event.type === "error") {
              return;
            }
            yield event;
          }
          if (closed) return;
          await new Promise<void>((resolve) => {
            resolver = resolve;
          });
          resolver = null;
        }
      })(),
      push: (event: LLMStreamEvent): void => {
        if (closed) return;
        queue.push(event);
        if (resolver) {
          resolver();
          resolver = null;
        }
      },
      complete: (): void => {
        if (closed) return;
        closed = true;
        queue.push({ type: "completed" });
        if (resolver) {
          resolver();
          resolver = null;
        }
      },
      error: (error: string): void => {
        if (closed) return;
        closed = true;
        queue.push({ type: "error", content: error });
        if (resolver) {
          resolver();
          resolver = null;
        }
      },
    };

    this.streams.set(streamId, stream);
    return stream;
  }

  @Traced({ 
    name: "env.handle_query", 
    log: true,
    recordParams: true, 
    recordResult: false,
    paramFilter: (args) => ({ query: args[0] })
  })
  async handle_query(query: string, context?: Context, history?: ModelMessage[]): Promise<string> {
    await this.ensureLLMInitialized();

    // Reload skills before each query to support dynamic skill addition
    const skillChanges = await this.loadSkills();

    // Handle skill changes notification
    if (skillChanges.added.length > 0 || skillChanges.removed.length > 0) {
      const messages: string[] = [];
      
      if (skillChanges.added.length > 0) {
        const addedList = skillChanges.added.map(s => `• ${s.name}: ${s.description}`).join("\n");
        messages.push(`📦 新增了 ${skillChanges.added.length} 个 skill:\n${addedList}`);
      }
      
      if (skillChanges.removed.length > 0) {
        messages.push(`🗑️ 删除了 ${skillChanges.removed.length} 个 skill: ${skillChanges.removed.join(", ")}`);
      }

      const notification = messages.join("\n\n");

      const msgId = `msg_${Date.now()}`;
      
      // Emit text event to frontend
      this.emitStreamEvent(
        { type: "text", content: notification, delta: "" },
        { session_id: context?.session_id || "default", message_id: msgId }
      );

      // Add assistant message to history
      history = history || [];
      history.push({
        role: "assistant",
        content: { type: "text", text: notification } as any,
      });
    }

    const event = {
      event_type: "user_query",
      timestamp: new Date().toISOString(),
      role: "user" as const,
      content: query,
    };

    // Get or create abort signal for this session
    const sessionId = context?.session_id;
    if (sessionId && !sessionAbortManager.has(sessionId)) {
      sessionAbortManager.create(sessionId);
    }

    const agentContext = {
      ...context,
      message_id: `msg_${Date.now()}`,
      abort: sessionId ? sessionAbortManager.get(sessionId) : undefined,
    };

    // 使用 getBehaviorSpec 获取行为规范
    // Agent 会在 run() 时自动调用 getBehaviorSpec
    const agent = new Agent(event, this as Environment, this.listTools(), agentContext, {}, history);
    return agent.run();
  }

  @Traced({ name: "env.handle_action", log: true, recordParams: true, recordResult: false })
  async handle_action(action: Action, ctx: Context): Promise<ToolResult> {
    const startTime = Date.now();
    const tool = this.getTool(action.tool_name);

    if (!tool) {
      const result: ToolResult = {
        success: false,
        output: "",
        error: `Tool not found: ${action.tool_name}`,
        metadata: {
          execution_time_ms: Date.now() - startTime,
        },
      };
      this.metrics.record(action.tool_name, result);
      return result;
    }

    const slotResult = await this.concurrencyManager.acquireSlot(action.tool_name);
    if (!slotResult.acquired) {
      const result: ToolResult = {
        success: false,
        output: "",
        error: `Failed to acquire concurrency slot for tool: ${action.tool_name}`,
        metadata: {
          execution_time_ms: Date.now() - startTime,
        },
      };
      this.metrics.record(action.tool_name, result);
      return result;
    }

    try {
      // 截断过长参数，保留前 300 字符
      const toolArgsStr = JSON.stringify(action.args);
      const truncatedToolArgs = toolArgsStr.length > 300 
        ? toolArgsStr.substring(0, 300) + "...[truncated]" 
        : toolArgsStr;
      BaseEnvironment.baseLogger.info("[BaseEnvironment.executeAction] Executing tool", {
        toolName: action.tool_name,
        actionId: action.action_id,
        toolArgs: truncatedToolArgs
      });
      
      this.emitStreamEvent({
        type: "tool_call",
        tool_name: action.tool_name,
        tool_args: action.args,
      }, ctx);

      const result = await this.errorRecovery.executeWithRecovery(
        async () => {
          const timeout = this.timeoutManager.getTimeout(action.tool_name, action);
          return this.executeWithTimeout(tool, action, ctx, timeout);
        },
        action.tool_name,
        action.action_id ?? `action_${Date.now()}`,
        action.args,
      );

      this.metrics.record(action.tool_name, result);
      return result;
    } finally {
      if (slotResult.slotId !== undefined) {
        this.concurrencyManager.releaseSlot(action.tool_name, slotResult.slotId);
      }
    }
  }

  private async executeWithTimeout(
    tool: Tool,
    action: Action,
    context: Context,
    timeoutMs: number,
  ): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Tool execution timeout: ${action.tool_name}`));
      }, timeoutMs);

      const abortHandler = (): void => {
        clearTimeout(timer);
        reject(new Error("Tool execution aborted"));
      };

      if (context.abort) {
        context.abort.addEventListener("abort", abortHandler);
      }

      // Pass env instance to tool context
      const toolContext = this.toToolContext(context);
      (toolContext as any).env = this;

      Promise.resolve(tool.execute(action.args, toolContext))
        .then((result) => {
          clearTimeout(timer);
          if (context.abort) {
            context.abort.removeEventListener("abort", abortHandler);
          }
          // 截断过长结果，保留前 300 字符
          const resultStr = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
          const truncatedResult = resultStr.length > 300 
            ? resultStr.substring(0, 300) + "...[truncated]" 
            : resultStr;
          BaseEnvironment.baseLogger.info("[BaseEnvironment.executeAction] Tool result received", {
            toolName: action.tool_name,
            success: result.success,
            resultLength: resultStr.length,
            result: truncatedResult
          });
          this.emitStreamEvent({
            type: "tool_result",
            tool_name: action.tool_name,
            tool_result: result.output,
            metadata: result.metadata,
          }, context);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          if (context.abort) {
            context.abort.removeEventListener("abort", abortHandler);
          }
          BaseEnvironment.baseLogger.error("[BaseEnvironment.executeAction] Tool execution error", {
            toolName: action.tool_name,
            error: error instanceof Error ? error.message : String(error)
          });
          this.emitStreamEvent({
            type: "error",
            content: error instanceof Error ? error.message : String(error),
            tool_name: action.tool_name,
          }, context);
          reject(error);
        });
    });
  }

  protected setSandboxConfig(config: SandboxConfig | undefined): void {
    this.sandboxConfig = config;
  }

  protected async getSandboxProvider(): Promise<ISandboxProvider | null> {
    if (!this.sandboxConfig?.enabled) {
      return null;
    }

    if (!this.sandboxProvider) {
      const type = this.sandboxConfig.type ?? "native";
      this.sandboxProvider = SandboxProviderFactory.create(type);
      await this.sandboxProvider.initialize(this.sandboxConfig);
    }

    return this.sandboxProvider;
  }

  private toToolContext(context: Context): ToolContext {
    return {
      workdir: context.workdir,
      user_id: context.user_id,
      session_id: context.session_id,
      abort: context.abort,
      metadata: {
        ...context.metadata,
        session_id: context.session_id,
        message_id: context.message_id,
      },
      sandbox: this.sandboxConfig,
      sandboxProvider: this.sandboxProvider,
    };
  }

  private toolToToolInfo(tool: ToolInfo): Tool {
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: tool.execute.bind(tool),
    };
  }

  getMetrics(toolName?: string): Map<string, AggregatedMetrics> {
    if (toolName) {
      const metrics = this.metrics.getMetrics(toolName);
      if (metrics) {
        const map = new Map<string, AggregatedMetrics>();
        map.set(toolName, metrics);
        return map;
      }
      return new Map();
    }
    return this.metrics.getAllMetrics();
  }

  resetMetrics(): void {
    this.metrics.reset();
  }

  getConcurrencyStatus(
    toolName?: string,
  ): Map<string, { active: number; waiting: number; limit: number }> {
    if (toolName) {
      const status = new Map<string, { active: number; waiting: number; limit: number }>();
      status.set(toolName, {
        active: this.concurrencyManager.getActiveCount(toolName),
        waiting: this.concurrencyManager.getWaitQueueLength(toolName),
        limit: this.concurrencyManager.getConcurrencyLimit(toolName),
      });
      return status;
    }

    const allStatus = new Map<string, { active: number; waiting: number; limit: number }>();
    for (const [name] of this.tools) {
      allStatus.set(name, {
        active: this.concurrencyManager.getActiveCount(name),
        waiting: this.concurrencyManager.getWaitQueueLength(name),
        limit: this.concurrencyManager.getConcurrencyLimit(name),
      });
    }
    return allStatus;
  }

  configureLLM(config: InvokeLLMConfig): void {
    this.llmConfig = config;
  }

  protected llmConfig?: InvokeLLMConfig;

  /**
   * Invoke LLM as a native environment capability
   * This is the primary way for agents to interact with LLM
    */
  @Traced({ name: "env.invokeLLM", log: true, recordParams: true, recordResult: false })
  async invokeLLM(
    messages: ModelMessage[],
    tools?: ToolInfo[],
    context?: Context,
    options?: Omit<LLMOptions, "messages" | "tools">
  ): Promise<ToolResult> {
    BaseEnvironment.baseLogger.info(`[BaseEnvironment.invokeLLM] session_id=${context?.session_id}, messageCount=${messages.length}`);
    for (let i = 0; i < Math.min(messages.length, 5); i++) {
      BaseEnvironment.baseLogger.info(`  message[${i}]: role=${messages[i].role}, content type=${typeof messages[i].content}`);
    }
    await this.ensureLLMInitialized();
    BaseEnvironment.baseLogger.debug("[BaseEnvironment.invokeLLM] LLM initialized", { hasConfig: !!this.llmConfig });

    if (!this.llmConfig) {
      BaseEnvironment.baseLogger.warn("[BaseEnvironment.invokeLLM] LLM not configured");
      return {
        success: false,
        output: "",
        error: "LLM not configured. Call configureLLM() first.",
        metadata: {
          execution_time_ms: 0,
        },
      };
    }

    const ctx = context || ({} as Context);
    BaseEnvironment.baseLogger.debug("[BaseEnvironment.invokeLLM] Calling invokeLLM", { messageCount: messages.length });

    const eventHandler: StreamEventHandler = {
      onStart: (metadata) => {
        BaseEnvironment.baseLogger.debug("[BaseEnvironment.invokeLLM] onStart callback");
        this.emitStreamEvent({ type: "start", metadata }, ctx);
      },
      onText: (content, delta) => {
        BaseEnvironment.baseLogger.debug("[BaseEnvironment.invokeLLM] onText callback", { contentLength: content.length });
        this.emitStreamEvent({ type: "text", content, delta }, ctx);
      },
      onReasoning: (content) => {
        BaseEnvironment.baseLogger.debug("[BaseEnvironment.invokeLLM] onReasoning callback", { contentLength: content.length });
        this.emitStreamEvent({ type: "reasoning", content }, ctx);
      },
      onToolCall: (toolName, toolArgs, toolCallId) => {
        BaseEnvironment.baseLogger.debug("[BaseEnvironment.invokeLLM] onToolCall callback", { toolName });
        this.emitStreamEvent(
          { type: "tool_call", tool_name: toolName, tool_args: toolArgs, tool_call_id: toolCallId },
          ctx
        );
      },
      onCompleted: (content, metadata) => {
        BaseEnvironment.baseLogger.debug("[BaseEnvironment.invokeLLM] onCompleted callback");
        this.emitStreamEvent({ type: "completed", content, metadata }, ctx);
      },
    };

    const result = await invokeLLM(
      this.llmConfig,
      {
        messages,
        tools,
        ...options,
        stream: true,
      },
      {
        workdir: process.cwd(),
        session_id: ctx.session_id,
        message_id: ctx.message_id,
        metadata: ctx.metadata,
        abort: ctx.abort,
      },
      eventHandler
    );
    
    BaseEnvironment.baseLogger.debug("[BaseEnvironment.invokeLLM] invokeLLM returned", { success: result.success });
    return result;
  }

  /**
   * Simple non-streaming LLM call for intuitive reasoning
   */
  async intuitiveReasoning(
    messages: ModelMessage[],
    options?: Omit<LLMOptions, "messages" | "tools" | "stream">
  ): Promise<ToolResult> {
    await this.ensureLLMInitialized();

    if (!this.llmConfig) {
      return {
        success: false,
        output: "",
        error: "LLM not configured. Call configureLLM() first.",
        metadata: {
          execution_time_ms: 0,
        },
      };
    }

    return intuitiveReasoning(
      this.llmConfig,
      {
        messages,
        ...options,
      },
      {
        workdir: process.cwd(),
      }
    );
  }

  protected abstract getDefaultTimeout(toolName: string): number;
  protected abstract getTimeoutOverride(action: Action): number | undefined;
  protected abstract getMaxRetries(toolName: string): number;
  protected abstract getRetryDelay(toolName: string): number;
  protected abstract isRetryableError(error: string): boolean;
  protected abstract getConcurrencyLimit(toolName: string): number;
  protected abstract getRecoveryStrategy(toolName: string): {
    type: "retry" | "fallback" | "skip" | "error";
    maxRetries?: number;
    fallbackTool?: string;
  };

  /**
  目录路径（子类 * 获取 Skills 实现）
   */
  protected abstract getSkillsDirectory(): string | undefined;

  /**
   * 获取内置 Skills 列表
   * 子类可覆盖以提供不同的内置 Skills
   * 返回 SkillInfo 数组，每个 SkillInfo 需要包含 id, name, description, path
   */
  protected getBuiltInSkills(): SkillInfo[] {
    return [];
  }

  /**
   * Skill 变动信息
   */
  protected lastLoadedSkills: Map<string, SkillInfo> = new Map();

  /**
   * 加载 Skills
   * 每次调用都会重新扫描 skills 目录，并重新注册 skillTool
   * 返回是否有新增或删除的 skills
   */
  public async loadSkills(): Promise<{ added: SkillInfo[]; removed: string[] }> {
    const skillsDir = this.getSkillsDirectory();
    const builtInSkills = this.getBuiltInSkills();
    
    if (!skillsDir && builtInSkills.length === 0) {
      console.log("[BaseEnvironment] No skills directory configured and no built-in skills");
      return { added: [], removed: [] };
    }

    const { SkillLoader } = await import("../skills/skill-loader.js");
    const { createSkillToolWithDescription } = await import("../skills/skill-tool.js");

    try {
      let allSkillInfos: SkillInfo[] = [];

      // Load built-in skills first
      if (builtInSkills.length > 0) {
        allSkillInfos.push(...builtInSkills);
        console.log(`[BaseEnvironment] Loaded ${builtInSkills.length} built-in skills`);
      }

      // Load user skills (can override built-in skills)
      if (skillsDir) {
        const userLoader = new SkillLoader(skillsDir);
        const userSkills = await userLoader.loadAll();
        
        // Merge: user skills override built-in skills with same ID
        const existingIds = new Set(allSkillInfos.map(s => s.id));
        for (const skill of userSkills) {
          if (existingIds.has(skill.id)) {
            // Override: remove built-in skill with same ID
            allSkillInfos = allSkillInfos.filter(s => s.id !== skill.id);
          }
          allSkillInfos.push(skill);
        }
        console.log(`[BaseEnvironment] Loaded ${userSkills.length} user skills`);
      }

      const added: SkillInfo[] = [];
      const removed: string[] = [];

      // Check for new skills
      for (const skill of allSkillInfos) {
        if (!this.lastLoadedSkills.has(skill.id)) {
          added.push(skill);
        }
      }

      // Check for removed skills
      for (const [id] of this.lastLoadedSkills) {
        if (!allSkillInfos.find(s => s.id === id)) {
          removed.push(id);
        }
      }

      this.skills.clear();
      for (const skill of allSkillInfos) {
        this.skills.set(skill.id, skill);
      }

      if (allSkillInfos.length > 0) {
        const skillToolWithDesc = createSkillToolWithDescription(allSkillInfos);
        this.registerTool(skillToolWithDesc);
      }

      // Update last loaded skills
      this.lastLoadedSkills = new Map(allSkillInfos.map(s => [s.id, s]));

      console.log(`[BaseEnvironment] Loaded ${this.skills.size} skills total`);
      
      if (added.length > 0) {
        console.log(`[BaseEnvironment] Added skills: ${added.map(s => s.id).join(", ")}`);
      }
      if (removed.length > 0) {
        console.log(`[BaseEnvironment] Removed skills: ${removed.join(", ")}`);
      }

      return { added, removed };
    } catch (error) {
      console.error("[BaseEnvironment] Failed to load skills:", error);
      return { added: [], removed: [] };
    } finally {
      this.skillsLoaded = true;
    }
  }

  // ========== MCP 相关 ==========

  /**
   * MCP 管理器
   */
  protected mcpManager: any = null;

  /**
   * 获取 MCP 服务器脚本目录（子类可覆盖）
   * 默认返回 undefined，表示不加载 MCP
   */
  protected getMcpserversDirectory(): string | undefined {
    return undefined;
  }

  /**
   * 初始化 MCP
   * 在子类构造函数中调用
   */
  protected async initializeMcp(mcpConfig?: any): Promise<void> {
    BaseEnvironment.baseLogger.info("[BaseEnvironment] initializeMcp called", { 
      hasMcpConfig: !!mcpConfig,
      mcpConfigKeys: mcpConfig?.clients ? Object.keys(mcpConfig.clients) : [],
    });
    
    const mcpserversDir = this.getMcpserversDirectory();
    
    if (!mcpserversDir && !mcpConfig?.clients) {
      BaseEnvironment.baseLogger.info("[BaseEnvironment] No MCP config provided, skipping MCP initialization");
      return;
    }

    if (mcpserversDir) {
      BaseEnvironment.baseLogger.info(`[BaseEnvironment] MCP servers directory: ${mcpserversDir}`);
    }

    // 动态导入 MCP 管理器
    const { McpManager } = await import("../../../env_spec/mcp/manager.js");
    // 传入 env 根目录用于相对路径解析
    const envRoot = mcpserversDir ? path.dirname(mcpserversDir) : undefined;
    this.mcpManager = new McpManager(mcpserversDir, envRoot);

    // 加载 MCP Clients（即使没有显式配置，也会扫描 mcpservers 目录）
    BaseEnvironment.baseLogger.info("[BaseEnvironment] Loading MCP clients", { clients: mcpConfig?.clients || {} });
    const result = await this.mcpManager.loadClients(mcpConfig?.clients ?? {});
    BaseEnvironment.baseLogger.info(`[BaseEnvironment] MCP load result`, { 
      loaded: result.loaded, 
      failed: result.failed,
    });

    // 注册 MCP 工具
    const mcpTools = this.mcpManager.getTools();
    BaseEnvironment.baseLogger.info("[BaseEnvironment] MCP tools to register", { 
      count: mcpTools.length,
      tools: mcpTools.map((t: any) => t.name),
    });
    
    for (const tool of mcpTools) {
      this.registerTool(tool);
    }
    BaseEnvironment.baseLogger.info(`[BaseEnvironment] Registered ${mcpTools.length} MCP tools`);
  }

  /**
   * 获取 MCP 工具描述（用于 system prompt）
   */
  public getMcpToolsDescription(): string {
    if (!this.mcpManager) {
      return "  No MCP tools currently available.";
    }
    return this.mcpManager.getToolsDescription();
  }

  /**
   * 重新加载 MCP Clients
   */
  public async reloadMcpClients(mcpConfig?: any): Promise<void> {
    if (!this.mcpManager) {
      return this.initializeMcp(mcpConfig);
    }

    // 断开所有现有客户端
    await this.mcpManager.disconnectAll();

    // 移除所有 MCP 工具
    const toolNames = Array.from(this.tools.keys()).filter(name => name.includes('_'));
    for (const name of toolNames) {
      // 只移除 MCP 工具（格式为 mcpName_toolName）
      if (name.includes('_')) {
        // 检查是否是 MCP 工具
        const mcpStatus = this.mcpManager.getClientStatus(name.split('_')[0]);
        if (mcpStatus) {
          this.tools.delete(name);
        }
      }
    }

    // 重新加载
    if (mcpConfig?.clients) {
      const result = await this.mcpManager.loadClients(mcpConfig.clients);
      console.log(`[BaseEnvironment] Reloaded ${result.loaded} MCP clients`);

      // 注册 MCP 工具
      const mcpTools = this.mcpManager.getTools();
      for (const tool of mcpTools) {
        this.registerTool(tool);
      }
    }
  }

  onStreamEvent?(event: StreamEvent, context: Context): void | Promise<void>;
  onSessionEvent?(event: SessionEvent): void | Promise<void>;

  protected emitStreamEvent(event: StreamEvent, context: Context): void | Promise<void> {
    if (this.onStreamEvent) {
      return this.onStreamEvent(event, context);
    }
  }

  protected emitSessionEvent(event: SessionEvent): void | Promise<void> {
    if (this.onSessionEvent) {
      return this.onSessionEvent(event);
    }
  }
}
