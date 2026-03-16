/**
 * @fileoverview ServerEnvironment - Environment with EventBus integration
 *
 * Extends BaseEnvironment to publish stream events via EventBus.
 */

import path from "path";
import { fileURLToPath } from "url";
import {
  BaseEnvironment,
  BaseEnvironmentConfig,
  type SessionEvent,
} from "../core/environment/base/base-environment.js";
import type { SkillInfo } from "../core/environment/skills/types.js";
import { BUILT_IN_SKILLS } from "./built-in-skills.js";

import type { Context } from "../core/types/context.js";
import type { Action } from "../core/types/action.js";
import type { StreamEvent } from "../core/environment/index.js";
import { EventTypes, type EnvEvent } from "../core/types/event.js";
import * as Bus from "./eventbus/bus.js";
import { EnvEventBus } from "./eventbus/bus.js";
import { ActiveSessionManager } from "./active-session-manager.js";
import {
  StreamStartEvent,
  StreamTextEvent,
  StreamReasoningEvent,
  StreamToolCallEvent,
  StreamToolResultEvent,
  StreamCompletedEvent,
  StreamErrorEvent,
} from "./eventbus/events/stream.js";
import {
  SessionCreatedEvent,
  SessionUpdatedEvent,
  SessionDeletedEvent,
} from "./eventbus/events/session.js";
import { Config_get, Config_reload, resolveConfig } from "../config/index.js";
import { ModelStore } from "../config/state/model-store.js";
import { Providers_getAll, type ProviderInfo } from "../config/providers.js";
import { Auth_getProvider } from "../config/auth.js";
import { ModelsConfig_getAll, type ModelEntry } from "../config/models-config.js";
import { configRegistry } from "../config/registry.js";
import { createEnvironmentSource, findEnvironmentPath } from "../config/sources/environment.js";
import { ConfigPaths } from "../config/paths.js";
import { loadPromptsFromEnvironment, resolveVariables, buildToolListDescription, buildEnvInfo } from "../config/prompts/index.js";
import { SpanCollector, setSpanCollector } from "../utils/span-collector.js";
import { InMemorySpanStorage } from "../utils/span-storage.js";
import { serverLogger } from "./logger.js";
import type { BackgroundTaskManager } from "../core/environment/expend/task/background-task-manager.js";
import { EventMcpManager } from "./env_spec/mcp/event-source/manager.js";
import type { EventSourceMcpConfig } from "./env_spec/mcp/event-source/types.js";
import type { McpConfig } from "../env_spec/mcp/types.js";

export interface ServerEnvironmentConfig extends BaseEnvironmentConfig {
  sessionId?: string;
  /** Whether to load configuration from config files. Defaults to true. */
  loadConfig?: boolean;
  /** Current model selection (in-memory only, not persisted) */
  currentModel?: {
    providerID: string;
    modelID: string;
  };
}

export class ServerEnvironment extends BaseEnvironment {
  private sessionId: string;
  private toolsRegistered: Promise<void>;
  private modelStore: ModelStore;
  private currentModelSelection: { providerID: string; modelID: string } | null = null;
  private configLoaded: Promise<void> = Promise.resolve();
  private skillsDirectory: string | undefined;
  private mcpserversDirectory: string | undefined;
  private eventBus: EnvEventBus;
  private envName: string = "default";
  private rulesDirectory: string | undefined;
  private promptsDirectory: string | undefined;
  private backgroundTaskManager: BackgroundTaskManager | undefined;
  private eventMcpManager: EventMcpManager | undefined;
  private eventSourceConfig: EventSourceMcpConfig | undefined;
  private activeSessionManager: ActiveSessionManager;
  
  // Track streaming content for interrupt handling
  private currentStreamingContent: {
    reasoning: string;
    text: string;
    toolCalls: Array<{ id: string; name: string; args: string }>;
  } = { reasoning: "", text: "", toolCalls: [] };

  constructor(config?: ServerEnvironmentConfig) {
    const envConfig: BaseEnvironmentConfig = {
      ...config,
      onStreamEvent: (event: StreamEvent, context: Context) => {
        this.handleStreamEvent(event, context);
      },
      onSessionEvent: (event: SessionEvent) => {
        this.handleSessionEvent(event);
      },
    };

    super(envConfig);
    this.sessionId = config?.sessionId || "default";
    this.modelStore = new ModelStore();
    this.eventBus = new EnvEventBus(this);
    this.eventMcpManager = new EventMcpManager(this);
    this.activeSessionManager = new ActiveSessionManager();

    // Initialize event rules
    this.initEventRules();

    // Initialize current model selection if provided
    if (config?.currentModel) {
      this.currentModelSelection = config.currentModel;
    }

    // Register default tools
    this.toolsRegistered = this.registerDefaultTools();

    // Load config and initialize LLM if loadConfig is not explicitly false
    // Note: Now loadFromConfig() can be called independently to reload configuration
    if (config?.loadConfig !== false) {
      this.configLoaded = this.loadFromConfig();
    }
  }

  /**
   * Load configuration from config files and initialize LLM
   * Supports fallback chain: current > config > recent > provider default
   * Can be called multiple times to reload configuration (e.g., after environment switch)
    */
  async loadFromConfig(): Promise<void> {
    try {
      serverLogger.info("[ServerEnvironment] Loading configuration...");

      // 1. Load config file first (this loads auth.json into env vars)
      const rawConfig = await Config_get();
      const config = await resolveConfig(rawConfig);

      // Apply logging configuration
      const { setLogDirOverride } = await import("../utils/logger.js");
      if (config.logging?.path) {
        setLogDirOverride(config.logging.path);
        serverLogger.info(`[ServerEnvironment] Logging path set to: ${config.logging.path}`);
      }

      // 0. Initialize ProviderManager for AI SDK integration (AFTER auth is loaded)
      const { providerManager } = await import("../llm/provider-manager.js");
      await providerManager.initialize();
      serverLogger.info(`[ServerEnvironment] ProviderManager initialized with ${providerManager.listProviders().length} providers`);

      // 1.1. Initialize session storage with persistence config
      const { Storage } = await import("../core/session/storage.js");
      await Storage.initialize({
        mode: config.session?.persistence?.mode, // Use undefined to let Storage use its default (sqlite)
        path: config.session?.persistence?.path,
        autoSave: config.session?.persistence?.autoSave ?? true,
      });
      serverLogger.info(`[ServerEnvironment] Session storage initialized: mode=${Storage.currentMode}`);

      // 1.4. Initialize trace collector if enabled
      const traceConfig = config.trace;
      if (traceConfig?.enabled) {
        const storage = new InMemorySpanStorage();
        const collector = new SpanCollector(storage);
        setSpanCollector(collector);
        serverLogger.info(`[ServerEnvironment] Trace collector initialized (recordParams=${traceConfig.recordParams ?? true}, recordResult=${traceConfig.recordResult ?? false}, log=${traceConfig.log ?? false})`);
      } else {
        serverLogger.info(`[ServerEnvironment] Trace collector disabled`);
      }

      // 1.5. Set skills directory and load skills
      if (config.activeEnvironment) {
        const { ConfigPaths } = await import("../config/paths.js");
        
        // 设置环境名称
        this.envName = config.activeEnvironment;
        
        // 获取环境目录路径（优先使用配置中的路径，否则搜索 local + global）
        const envBasePath = config._environmentPath || (await findEnvironmentPath(config.activeEnvironment || ""))?.path;
        
        // 设置行为规范目录（使用找到的实际路径）
        this.rulesDirectory = path.join(
          envBasePath || ConfigPaths.environments
        );
        serverLogger.info(`[ServerEnvironment] rulesDirectory: ${this.rulesDirectory}`);
        this.promptsDirectory = path.join(
          envBasePath || ConfigPaths.environments,
          "prompts"
        );
        
        // 加载行为规范（env rules + agent prompts）
        await this.loadBehaviorSpec();
        
        // 使用环境目录路径，不需要再加 activeEnvironment
        this.skillsDirectory = path.join(
          envBasePath || ConfigPaths.environments,
          "skills"
        );
        serverLogger.info(`[ServerEnvironment] skillsDirectory: ${this.skillsDirectory}`);
        await this.loadSkills();

        // 1.6. Set mcpservers directory and load MCP clients
        this.mcpserversDirectory = path.join(
          envBasePath || ConfigPaths.environments,
          "mcpservers"
        );
        serverLogger.info(`[ServerEnvironment] Using environment path: ${envBasePath || ConfigPaths.environments}`);
        await this.initializeMcp(config.mcp);

        // 1.6.1 Initialize EventSource MCP clients
        this.eventSourceConfig = (config.mcp as any)?.eventSources;
        if (this.eventSourceConfig?.enabled) {
          await this.initEventSources(config.mcp?.clients, envBasePath);
        }

        // 1.7. Load prompts from environment config
        serverLogger.info(`[ServerEnvironment] activeEnvironment: ${config.activeEnvironment}`);
        const loadedPrompts = await loadPromptsFromEnvironment(
          config.activeEnvironment || "",
          envBasePath || ConfigPaths.environments
        );
        serverLogger.info(`[ServerEnvironment] loadedPrompts count: ${loadedPrompts.length}`);
        
        if (loadedPrompts.length > 0) {
          serverLogger.info(`[ServerEnvironment] loading ${loadedPrompts.length} prompts...`);
          const tools = this.listTools();
          const toolListDesc = buildToolListDescription(tools.map((t) => ({ name: t.name, description: t.description })));
          const envInfo = buildEnvInfo(config.activeEnvironment || "unknown");
          const envName = config.activeEnvironment || "unknown";
          
          const resolvedPrompts = loadedPrompts.map((p) => ({
            id: p.id,
            content: resolveVariables(p.content, {
              toolList: toolListDesc,
              capabilities: "",
              envName,
              agentId: p.id,
              role: p.metadata.role || "system",
              envInfo,
            }),
          }));
          
          this.loadPromptsFromConfig(resolvedPrompts);
          serverLogger.info(`[ServerEnvironment] Loaded ${resolvedPrompts.length} prompts from ${envName}`);
          
          // Verify prompts are loaded
          const sysPrompt = this.getPrompt("system");
          serverLogger.info(`[ServerEnvironment] getPrompt('system'): ${sysPrompt?.content?.slice(0, 50)}...`);
        } else {
          serverLogger.info(`[ServerEnvironment] No prompts loaded - prompts directory may not exist`);
        }
      }

      // 2. Load user model preferences
      await this.modelStore.load();
      const recent = await this.modelStore.getRecent();

      // 3. Get all providers
      const providers = await Providers_getAll();

      // 4. Parse config model if present
      const configModel = config.defaultModel
        ? this.parseModelString(config.defaultModel)
        : null;

      // 5. Select model with fallback chain
      const selectedModel = await this.selectModelWithFallback(
        this.currentModelSelection,
        configModel,
        recent,
        providers
      );

      if (selectedModel) {
        console.log(
          `[ServerEnvironment] Selected model: ${selectedModel.providerID}/${selectedModel.modelID}`
        );

        // 6. Get API key
        const authInfo = await Auth_getProvider(selectedModel.providerID);
        if (!authInfo?.key) {
          console.warn(
            `[ServerEnvironment] No API key found for provider: ${selectedModel.providerID}`
          );
          return;
        }

        // 7. Get baseURL
        const providerInfo = providers.find(
          (p) => p.id === selectedModel.providerID
        );
        const baseURL =
          providerInfo?.baseURL ||
          authInfo.baseURL ||
          config.baseURL ||
          "https://api.openai.com/v1";

        // 8. Initialize LLM
        const modelFullName = `${selectedModel.providerID}/${selectedModel.modelID}`;
        await this.configureLLMWithModel(modelFullName, baseURL, authInfo.key);

        // 9. Update current selection (in-memory only)
        this.currentModelSelection = selectedModel;

        serverLogger.info("[ServerEnvironment] LLM initialized successfully");
      } else {
        serverLogger.info(
          "[ServerEnvironment] No valid model configuration found, skipping LLM initialization"
        );
      }
    } catch (error) {
      serverLogger.error(
        "[ServerEnvironment] Failed to load configuration:",
        error
      );
      // Don't throw - allow environment to work without LLM config
    }
  }

  /**
   * Select model with fallback chain
   * Priority: recent > config > provider default
   * 
   * Note: Recent models (user's last selection) take highest priority,
   * followed by config defaults, then provider defaults.
   */
  private async selectModelWithFallback(
    currentSelection: { providerID: string; modelID: string } | null,
    configModel: { providerID: string; modelID: string } | null,
    recent: Array<{ providerID: string; modelID: string }>,
    providers: ProviderInfo[]
  ): Promise<{ providerID: string; modelID: string } | null> {
    // 1. Check ModelStore recent list (highest priority - user's last selection)
    for (const entry of recent) {
      if (await this.isModelValid(entry, providers)) {
        serverLogger.info(`[ServerEnvironment] Using recent model: ${entry.providerID}/${entry.modelID}`);
        return entry;
      }
    }

    // 2. Check config default model
    if (configModel && (await this.isModelValid(configModel, providers))) {
      serverLogger.info(`[ServerEnvironment] Using config default model: ${configModel.providerID}/${configModel.modelID}`);
      return configModel;
    }

    // 3. Use first available provider's default model
    for (const provider of providers) {
      if (provider.models && provider.models.length > 0) {
        // Use defaultModel or first model
        const defaultModel = provider.defaultModel || provider.models[0];
        serverLogger.info(`[ServerEnvironment] Using provider default model: ${provider.id}/${defaultModel}`);
        return {
          providerID: provider.id,
          modelID: defaultModel,
        };
      }
    }

    return null;
  }

  /**
   * Validate if model is valid
   * Checks: 1) Config models, 2) Provider models, 3) Provider defaultModel
   */
  private async isModelValid(
    model: { providerID: string; modelID: string },
    providers: ProviderInfo[]
  ): Promise<boolean> {
    // 1. Check config models first (from models.jsonc)
    const configModels = await ModelsConfig_getAll();
    for (const providerModels of configModels) {
      if (providerModels.providerID === model.providerID) {
        const found = providerModels.models.find(
          (m: ModelEntry) => m.modelId === model.modelID
        );
        if (found) return true;
      }
    }

    // 2. Check provider's model list
    const provider = providers.find((p) => p.id === model.providerID);
    if (provider) {
      if (provider.models && provider.models.includes(model.modelID)) {
        return true;
      }

      // 3. Check if it's the defaultModel
      if (provider.defaultModel === model.modelID) {
        return true;
      }
    }

    return false;
  }

  /**
   * Parse model string (e.g., "anthropic/claude-3-sonnet")
   */
  private parseModelString(modelString: string): { providerID: string; modelID: string } | null {
    const parts = modelString.split("/");
    if (parts.length === 2) {
      return { providerID: parts[0], modelID: parts[1] };
    }
    return null;
  }

  /**
   * Switch current model (called by models command)
   */
  async switchModel(providerID: string, modelID: string): Promise<boolean> {
    try {
      const providers = await Providers_getAll();

      // Validate model
      if (!(await this.isModelValid({ providerID, modelID }, providers))) {
        serverLogger.error(`[ServerEnvironment] Invalid model: ${providerID}/${modelID}`);
        return false;
      }

      // Get API key
      const authInfo = await Auth_getProvider(providerID);
      if (!authInfo?.key) {
        serverLogger.error(`[ServerEnvironment] No API key for provider: ${providerID}`);
        return false;
      }

      // Get baseURL
      const providerInfo = providers.find((p) => p.id === providerID);
      const baseURL =
        providerInfo?.baseURL || authInfo.baseURL || "https://api.openai.com/v1";

      // Re-initialize LLM
      const modelFullName = `${providerID}/${modelID}`;
      await this.configureLLMWithModel(modelFullName, baseURL, authInfo.key);

      // Update current selection
      this.currentModelSelection = { providerID, modelID };

      // Add to recent
      await this.modelStore.addRecent(providerID, modelID);

      serverLogger.info(`[ServerEnvironment] Switched to model: ${providerID}/${modelID}`);
      return true;
    } catch (error) {
      serverLogger.error("[ServerEnvironment] Failed to switch model", { error: String(error) });
      return false;
    }
  }

  /**
   * Get current selected model
   */
  getCurrentModel(): { providerID: string; modelID: string } | null {
    return this.currentModelSelection;
  }

  /**
   * Switch to a different environment
   * Updates config registry and reloads configuration without recreating the environment instance
   * @param envName Name of the environment to switch to
   * @param context Optional context including session_id for notifications
   * @returns true if switch successful, false otherwise
   */
  async switchEnvironment(envName: string, context?: Context): Promise<boolean> {
    try {
      console.log(`[ServerEnvironment] Switching to environment: ${envName}`);
      
      // Get old environment info before switching
      const oldEnvName = (await Config_get()).activeEnvironment || "unknown";
      const oldToolsCount = this.getTools().length;
      const oldSkills = this.listSkills();
      const oldSkillNames = oldSkills.map(s => s.id);
      
      // 1. Update config registry: remove old environment sources and add new one
      const sources = configRegistry.getSources();
      for (const source of sources) {
        if (source.name.startsWith("environment:")) {
          configRegistry.unregister(source.name);
        }
      }
      
      // 2. Register new environment source
      const newEnvSource = createEnvironmentSource(envName, 10);
      configRegistry.register(newEnvSource);
      
      // 3. Reload configuration from new environment
      await Config_reload();
      
      // 4. Unregister old MCP tools before reloading
      if (this.mcpManager) {
        const oldServerNames = this.mcpManager.getServerNames();
        for (const serverName of oldServerNames) {
          const mcpTools = this.mcpManager.getTools().filter((t: any) => t.name.startsWith(`${serverName}_`));
          for (const tool of mcpTools) {
            this.unregisterTool(tool.name);
          }
        }
        // Disconnect all MCP clients before creating new manager
        await this.mcpManager.disconnectAll();
      }
      
      // 5. Update mcpservers directory for new environment - use actual env path
      const envInfo = await findEnvironmentPath(envName);
      const envBasePath = envInfo?.path || ConfigPaths.environments;
      this.mcpserversDirectory = path.join(envBasePath, "mcpservers");
      
      serverLogger.info(`[ServerEnvironment] switchEnvironment: using env path: ${envBasePath}`);
      
      // 6. Get new config and create new MCP manager with new directory
      const newConfig = await Config_get();
      await this.initializeMcp(newConfig.mcp);
      
      // 7. Register new MCP tools
      let newMcpToolsCount = 0;
      if (this.mcpManager) {
        const mcpTools = this.mcpManager.getTools();
        newMcpToolsCount = mcpTools.length;
        for (const tool of mcpTools) {
          this.registerTool(tool);
        }
      }

      // 7.5. Update skills directory and reload skills - use actual env path
      this.skillsDirectory = path.join(envBasePath, "skills");
      await this.loadSkills();
      
      // 7.6. Update behavior spec for new environment
      this.envName = envName;
      this.rulesDirectory = envBasePath;
      this.promptsDirectory = path.join(envBasePath, "prompts");
      await this.refreshBehaviorSpec();

      // 8. Re-initialize LLM with new config (but skip MCP since already initialized above)
      const rawConfig = await Config_get();
      const config = await resolveConfig(rawConfig);
      await this.modelStore.load();
      const recent = await this.modelStore.getRecent();
      const providers = await Providers_getAll();
      const configModel = config.defaultModel
        ? this.parseModelString(config.defaultModel)
        : null;
      const selectedModel = await this.selectModelWithFallback(
        this.currentModelSelection,
        configModel,
        recent,
        providers
      );
      if (selectedModel) {
        this.currentModelSelection = selectedModel;
      }
      await this.ensureLLMInitialized?.();
      
      // 9. Build notification message about environment changes
      const newToolsCount = this.getTools().length;
      const newSkills = this.listSkills();
      const newSkillIds = newSkills.map(s => s.id);
      
      // Calculate skill changes
      const addedSkills = newSkillIds.filter(id => !oldSkillNames.includes(id));
      const removedSkills = oldSkillNames.filter(id => !newSkillIds.includes(id));
      
      const messages: string[] = [];
      
      messages.push(`🔄 **环境已切换**: ${oldEnvName} → ${envName}`);
      
      if (newToolsCount !== oldToolsCount) {
        messages.push(`📝 **可用工具**: ${oldToolsCount} → ${newToolsCount} 个`);
      }
      
      if (this.mcpManager) {
        const mcpServers = this.mcpManager.getServerNames();
        if (mcpServers.length > 0) {
          messages.push(`🛠️ **MCP 服务**: ${mcpServers.join(", ")}`);
          messages.push(`🔧 **MCP 工具**: ${newMcpToolsCount} 个`);
        }
      }
      
      if (addedSkills.length > 0 || removedSkills.length > 0) {
        const parts: string[] = [];
        if (addedSkills.length > 0) {
          parts.push(`+${addedSkills.join(", ")}`);
        }
        if (removedSkills.length > 0) {
          parts.push(`-${removedSkills.join(", ")}`);
        }
        messages.push(`📦 **Skills**: ${parts.join(" | ")}`);
      } else if (newSkills.length > 0) {
        const skillNames = newSkills.map(s => s.name).join(", ");
        messages.push(`📦 **Skills**: ${skillNames}`);
      }
      
      if (newConfig.defaultModel) {
        messages.push(`🤖 **模型**: ${newConfig.defaultModel}`);
      }
      
      const notification = messages.join("\n");
      const sessionId = context?.session_id;
      const messageId = `msg_${Date.now()}`;

      // Only emit stream event if we have a valid sessionId (not undefined or "default")
      if (sessionId && sessionId !== "default") {
        // Emit stream event to frontend
        this.emitStreamEvent(
          { type: "text", content: notification, delta: "" },
          { session_id: sessionId, message_id: messageId }
        );

        // Try to add message to session history if session exists in memory
        // Note: Sessions need to be loaded/created first via createSession API
        try {
          const { Storage } = await import("../core/session/index.js");
          const session = Storage.getSession(sessionId);
          if (session) {
            session.addMessage({
              id: messageId,
              sessionID: sessionId,
              role: "assistant",
              timestamp: Date.now(),
            }, [
              {
                id: `prt_${Date.now()}`,
                type: "text",
                text: notification,
              },
            ]);
          }
        } catch (err) {
          // Ignore session errors
        }
      }
      
      console.log(`[ServerEnvironment] Switched to environment: ${envName}`);
      return true;
    } catch (error) {
      console.error(`[ServerEnvironment] Failed to switch environment: ${error}`);
      return false;
    }
  }

  async waitForReady(): Promise<void> {
    // Wait for configuration loading
    await this.configLoaded;
    // Wait for base class LLM initialization
    await (this as any).ensureLLMInitialized?.();
    // Wait for tools registration
    await this.toolsRegistered;
    // Small delay to ensure everything is settled
    await new Promise(r => setTimeout(r, 100));
  }

  stopBackgroundTasksForSession(parentSessionId: string): number {
    if (!this.backgroundTaskManager) {
      serverLogger.info("[ServerEnvironment] No backgroundTaskManager available");
      return 0;
    }

    const tasks = this.backgroundTaskManager.listTasks(parentSessionId);
    let stoppedCount = 0;

    for (const task of tasks) {
      if (task.status === "running" || task.status === "pending") {
        const result = this.backgroundTaskManager.stopTask(task.id);
        if (result.success) {
          stoppedCount++;
          serverLogger.info(`[ServerEnvironment] Stopped background task`, {
            taskId: task.id,
            parentSessionId
          });
        }
      }
    }

    serverLogger.info(`[ServerEnvironment] Stopped ${stoppedCount} background tasks for session`, {
      parentSessionId,
      totalTasks: tasks.length,
      stoppedCount
    });

    return stoppedCount;
  }

  private async registerDefaultTools(): Promise<void> {
    try {
      const toolsModule = await import(
        "../core/environment/expend/os/tools/index.js"
      );
      const osTools = toolsModule.createOsTools();
      const todoTools = toolsModule.createTodoTools();
      
      // Import and create webfetch tool
      const { createWebFetchTool } = await import("../tools/web/web-fetch.js");
      const webFetchTool = createWebFetchTool({
        maxChars: 50000,
        timeout: 30000,
      });

      // Import and create LSP tool
      const { createLSPTool } = await import("../core/environment/lsp/lsp-tool.js");
      const lspTool = createLSPTool();

      // Import and create fetch_agent_core_source tool
      const { fetchAgentCoreSourceTool } = await import("../tools/github/index.js");

      // Import and create trace analysis tools
      const { createListRequestIdsTool } = await import("../tools/trace/list-request-ids.js");
      const { createGetFirstLogTool } = await import("../tools/trace/get-first-log.js");
      const { createGetLogsForRequestTool } = await import("../tools/trace/get-logs-for-request.js");
      const listRequestIdsTool = createListRequestIdsTool();
      const getFirstLogTool = createGetFirstLogTool();
      const getLogsForRequestTool = createGetLogsForRequestTool();

      // Import and create get_trace tool
      const { createGetTraceTool } = await import("../tools/trace/get-trace.js");
      const getTraceTool = createGetTraceTool();

      // All tools are external - LLM capabilities are native to Environment
      const allTools = [
        ...osTools,
        ...todoTools,
        webFetchTool,
        lspTool,
        fetchAgentCoreSourceTool,
        listRequestIdsTool,
        getFirstLogTool,
        getLogsForRequestTool,
        getTraceTool,
      ];

      for (const tool of allTools) {
        this.registerTool(tool);
      }

      // Register base skill tool (will be replaced by loadSkills if skills exist)
      const { baseSkillTool } = await import("../core/environment/skills/skill-tool.js");
      this.registerTool(baseSkillTool);

      // Register TaskTool and StopTaskTool for subagent delegation
      const { createTaskTool } = await import("../core/environment/expend/task/task-tool.js");
      const { createStopTaskTool } = await import("../core/environment/expend/task/stop-task-tool.js");
      const { tool: taskTool, backgroundTaskManager } = createTaskTool(this);
      this.backgroundTaskManager = backgroundTaskManager;
      const stopTaskTool = createStopTaskTool(backgroundTaskManager);
      this.registerTool(taskTool);
      this.registerTool(stopTaskTool);

      console.log(`[ServerEnvironment] Registered ${allTools.length + 3} tools (including skill tool, task tool, stop_task tool):`, allTools.map((t: any) => t.name));
    } catch (err) {
      console.error("[ServerEnvironment] Failed to register tools:", err);
      console.log("[ServerEnvironment] Continuing without OS tools");
    }
  }

  protected getSkillsDirectory(): string | undefined {
    return this.skillsDirectory;
  }

  protected getBuiltInSkills(): SkillInfo[] {
    return BUILT_IN_SKILLS;
  }

  protected getMcpserversDirectory(): string | undefined {
    return this.mcpserversDirectory;
  }

  /**
   * 初始化 EventSource MCP Clients
   */
  private async initEventSources(mcpClientsConfig?: Record<string, any>, envRoot?: string): Promise<void> {
    if (!mcpClientsConfig) {
      serverLogger.info("[ServerEnvironment] No MCP clients config for EventSources");
      return;
    }

    if (!this.eventMcpManager) {
      serverLogger.warn("[ServerEnvironment] EventMcpManager not initialized");
      return;
    }

    // Set envRoot for path resolution
    (this.eventMcpManager as any).envRoot = envRoot;

    try {
      await this.eventMcpManager.loadClients(
        mcpClientsConfig,
        this.eventSourceConfig?.sources as any
      );
      
      // 注册 EventSource MCP 工具到 Environment
      const eventSourceTools = this.eventMcpManager.getTools();
      for (const tool of eventSourceTools) {
        this.registerTool(tool);
      }
      
      serverLogger.info("[ServerEnvironment] EventSources initialized", {
        sources: this.eventMcpManager.getEventSourceNames(),
        toolsRegistered: eventSourceTools.length
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      serverLogger.error("[ServerEnvironment] Failed to initialize EventSources", { error: errorMsg });
    }
  }

  /**
   * 获取 EventSource 管理器
   */
  getEventMcpManager(): EventMcpManager | undefined {
    return this.eventMcpManager;
  }

  /**
   * 获取 ActiveSession 管理器
   */
  getActiveSessionManager(): ActiveSessionManager {
    return this.activeSessionManager;
  }

  /**
   * 手动添加 EventSource
   */
  async addEventSource(name: string, config: any): Promise<void> {
    if (!this.eventMcpManager) {
      this.eventMcpManager = new EventMcpManager(this, this.mcpserversDirectory ? path.dirname(this.mcpserversDirectory) : undefined);
    }
    await this.eventMcpManager.loadClients({ [name]: config }, {
      [name]: { name, client: config, enabled: true }
    });
  }

  protected override getRulesFilePath(): string | undefined {
    if (!this.rulesDirectory) return undefined;
    return path.join(this.rulesDirectory, "rules.md");
  }

  protected override getPromptsDirectory(): string | undefined {
    return this.promptsDirectory;
  }

  protected override getEnvName(): string {
    return this.envName;
  }

  protected getDefaultTimeout(toolName: string): number {
    return 30000;
  }

  protected getTimeoutOverride(action: Action): number | undefined {
    return undefined;
  }

  protected getMaxRetries(toolName: string): number {
    return 3;
  }

  protected getRetryDelay(toolName: string): number {
    return 1000;
  }

  protected isRetryableError(error: string): boolean {
    const retryablePatterns = [
      "ETIMEDOUT",
      "ECONNRESET",
      "ENOTFOUND",
      "rate limit",
      "429",
      "503",
    ];
    return retryablePatterns.some((pattern) =>
      error.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  protected getConcurrencyLimit(toolName: string): number {
    return 5;
  }

  protected getRecoveryStrategy(toolName: string): {
    type: "retry" | "fallback" | "skip" | "error";
    maxRetries?: number;
    fallbackTool?: string;
  } {
    return {
      type: "retry",
      maxRetries: 3,
    };
  }

  private async handleStreamEvent(
    event: StreamEvent,
    context: Context
  ): Promise<void> {
    const sessionId = context.session_id || this.sessionId;
    const messageId = context.message_id || `msg_${Date.now()}`;

    switch (event.type) {
      case "start":
        // Reset streaming content for new request
        this.currentStreamingContent = { reasoning: "", text: "", toolCalls: [] };
        await Bus.publish(
          StreamStartEvent,
          {
            sessionId,
            messageId,
            model: (event.metadata?.model as string) || "unknown",
          },
          sessionId
        );
        break;

      case "text":
        this.currentStreamingContent.text = event.content || "";
        await Bus.publish(
          StreamTextEvent,
          {
            sessionId,
            messageId,
            content: event.content || "",
            delta: event.delta || "",
          },
          sessionId
        );
        break;

      case "reasoning":
        this.currentStreamingContent.reasoning = event.content || "";
        await Bus.publish(
          StreamReasoningEvent,
          {
            sessionId,
            messageId,
            content: event.content || "",
          },
          sessionId
        );
        break;

      case "tool_call":
        if (event.tool_name) {
          this.currentStreamingContent.toolCalls.push({
            id: event.tool_call_id || "",
            name: event.tool_name,
            args: JSON.stringify(event.tool_args || {}),
          });
        }
        await Bus.publish(
          StreamToolCallEvent,
          {
            sessionId,
            messageId,
            toolName: event.tool_name || "",
            toolArgs: event.tool_args || {},
            toolCallId: event.tool_call_id || "",
            reason: event.reason,
          },
          sessionId
        );
        break;

      case "tool_result":
        await Bus.publish(
          StreamToolResultEvent,
          {
            sessionId,
            messageId,
            toolName: event.tool_name || "",
            toolCallId: event.tool_call_id || "",
            result: event.tool_result,
            metadata: event.metadata,
            success: true,
          },
          sessionId
        );
        break;

      case "completed":
        await Bus.publish(
          StreamCompletedEvent,
          {
            sessionId,
            messageId,
            usage: event.metadata?.usage as any,
          },
          sessionId
        );
        break;

      case "error":
        await Bus.publish(
          StreamErrorEvent,
          {
            sessionId,
            messageId,
            error: event.error || "Unknown error",
            code: event.code,
          },
          sessionId
        );
        break;

      default:
        console.warn(
          "[ServerEnvironment] Unknown stream event type:",
          event.type
        );
    }
  }

  private async handleSessionEvent(event: SessionEvent): Promise<void> {
    const sessionId = event.sessionId || this.sessionId;
    switch (event.type) {
      case "session.created":
        await Bus.publish(
          SessionCreatedEvent,
          {
            sessionId: event.sessionId,
            title: event.title,
            directory: event.directory,
          },
          sessionId
        );
        break;
      case "session.updated":
        await Bus.publish(
          SessionUpdatedEvent,
          {
            sessionId: event.sessionId,
            updates: event.updates,
          },
          sessionId
        );
        break;
      case "session.deleted":
        await Bus.publish(
          SessionDeletedEvent,
          { sessionId: event.sessionId },
          sessionId
        );
        break;
    }
  }

  async publishEvent<T>(event: EnvEvent<T>): Promise<void> {
    await this.eventBus.publish(event);
  }

  private initEventRules(): void {
    const bus = this.eventBus;

    bus.registerRule({
      eventType: EventTypes.USER_QUERY,
      handler: {
        type: "function",
        fn: async (event: EnvEvent) => {
          const { sessionId, content } = event.payload as { sessionId: string; content: string };
          const session = await this.getSession!(sessionId);
          const history = await session?.toHistory() || [];
          
          session?.addUserMessage(content);
          
          // Wait for config to be loaded (including prompts)
          await this.configLoaded;
          
          try {
            const response = await this.handle_query(content, { 
              session_id: sessionId,
              onMessageAdded: (message) => {
                session?.addMessageFromModelMessage(message);
              }
            }, history);
            
            // Save assistant message with reasoning if available
            if (this.currentStreamingContent.reasoning) {
              session?.addAssistantMessage(`[Reasoning]\n${this.currentStreamingContent.reasoning}\n\n[Output]\n${response}`);
            } else {
              session?.addAssistantMessage(response);
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const messageId = `msg_${Date.now()}`;
            
            // Send error event to frontend
            await Bus.publish(
              StreamErrorEvent,
              {
                sessionId,
                messageId,
                error: errorMessage,
                code: error instanceof Error ? error.constructor.name : "Error",
              },
              sessionId
            );
            
            // Check if it's an abort error
            if (errorMessage === "Agent execution aborted") {
              console.log("[ServerEnvironment] Session interrupted, saving partial response");
              
              // Save reasoning content if exists
              if (this.currentStreamingContent.reasoning) {
                session?.addAssistantMessage(`[Reasoning]\n${this.currentStreamingContent.reasoning}\n\n[Output]\n${this.currentStreamingContent.text || "(interrupted)"}`);
              } else if (this.currentStreamingContent.text) {
                session?.addAssistantMessage(this.currentStreamingContent.text);
              }
              
              // Add user interrupt notice message
              session?.addUserMessage("[Session interrupted by user]");
            }
            // Don't re-throw - error has already been sent to frontend via StreamErrorEvent
            // The "Failed to publish event" log entry is now benign
          }
        }
      },
      options: { priority: 100 }
    });

    bus.registerRule({
      eventType: [EventTypes.SESSION_CREATED, EventTypes.SESSION_UPDATED, EventTypes.SESSION_DELETED],
      handler: {
        type: "function",
        fn: (event: EnvEvent): Promise<void> => {
          console.log(`[EventBus] Session event: ${event.type}`, event);
          return Promise.resolve();
        }
      },
      options: { priority: 50 }
    });

    bus.registerRule({
      eventType: EventTypes.BACKGROUND_TASK_COMPLETED,
      handler: {
        type: "agent",
        prompt: `A background task has completed.

Task Description: {{payload.description}}
SubAgent Type: {{payload.subagentType}}
Execution Time: {{payload.execution_time_ms}}ms
Sub Session ID: {{payload.sub_session_id}}

Result:
{{payload.result}}

Analyze this result and provide a clear summary to the user. If there are any errors, explain them and suggest next steps.`,
      },
      options: { priority: 80 }
    });

    bus.registerRule({
      eventType: EventTypes.BACKGROUND_TASK_FAILED,
      handler: {
        type: "agent",
        prompt: `A background task has failed.

Task Description: {{payload.description}}
SubAgent Type: {{payload.subagentType}}
Error: {{payload.error}}

The task failed to complete. Explain the error to the user and suggest possible next steps (retry, different approach, etc.).`,
      },
      options: { priority: 80 }
    });

    bus.registerRule({
      eventType: EventTypes.BACKGROUND_TASK_PROGRESS,
      handler: {
        type: "agent",
        prompt: `后台任务正在执行中。

📋 任务: {{payload.description}}
🔄 类型: {{payload.subagentType}}
⏱️ 已执行: {{payload.elapsed_time_human}}
📌 Task ID: {{payload.taskId}}

Please briefly inform the user that the task is still in progress.`,
      },
      options: { priority: 80 }
    });

    bus.registerRule({
      eventType: EventTypes.BACKGROUND_TASK_TIMEOUT,
      handler: {
        type: "agent",
        prompt: `后台任务执行超时，已暂停。

📋 任务: {{payload.description}}
🔄 类型: {{payload.subagentType}}
⏱️ 执行时长: {{payload.execution_time_ms}}秒
📌 Task ID: {{payload.taskId}}
📝 Sub Session ID: {{payload.sub_session_id}}

{{payload.message}}

Please inform the user that the task has timed out and ask if they want to continue or adjust the approach.`,
      },
      options: { priority: 80 }
    });

    bus.registerRule({
      eventType: EventTypes.BACKGROUND_TASK_STOPPED,
      handler: {
        type: "agent",
        prompt: `后台任务已被用户停止。

📋 任务: {{payload.description}}
🔄 类型: {{payload.subagentType}}
⏱️ 执行时长: {{payload.execution_time_ms}}秒
📌 Task ID: {{payload.taskId}}

Please confirm the task has been stopped and ask if the user needs any other help.`,
      },
      options: { priority: 80 }
    });

    bus.registerRule({
      eventType: EventTypes.ENVIRONMENT_SWITCHED,
      handler: {
        type: "agent",
        prompt: "You are an environment switching expert. The environment has been switched. Analyze the change and decide how to proceed with the current task.",
      },
      options: { priority: 80 }
    });

    bus.registerRule({
      eventType: "timer.*",
      handler: {
        type: "function",
        fn: async (event) => {
// DEBUG `[TimerEvent] Received: ${event.type}`, { id: event.id, payload: event.payload, metadata: event.metadata } // 已精简
        }
      },
      options: { priority: 50 }
    });

    bus.registerRule({
      eventType: "*",
      handler: {
        type: "agent",
        prompt: `You are an event handling expert. Analyze event content and decide: 1) respond to user; 2) continue execution; 3) interact with user for confirmation.`
      },
      options: { priority: 10 }
    });
  }
}
