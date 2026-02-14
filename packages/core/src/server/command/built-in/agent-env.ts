/**
 * @fileoverview AgentEnv Command - Environment management for agent-core
 *
 * Manages agent environments with CRUD operations and switching capability.
 * Environment configurations are stored in ~/.config/tong_work/agent-core/environments/
 */

import type { Command, CommandContext, CommandResult } from "../types.js";
import fs from "fs/promises";
import path from "path";
import { ConfigPaths } from "../../../config/paths.js";
import { Config_get, Config_reload } from "../../../config/config.js";
import { loadEnvironmentConfig, createEnvironmentSource } from "../../../config/sources/environment.js";
import { configRegistry } from "../../../config/registry.js";

// Action types
interface AgentEnvAction {
  type: "list" | "select" | "create" | "update" | "delete";
  envName?: string;
  config?: Partial<EnvironmentConfig>;
}

// Environment configuration structure
interface EnvironmentConfig {
  id: string;
  displayName: string;
  description?: string;
  defaultModel?: string;
  baseURL?: string;
  apiKey?: string;
  capabilities?: {
    logs?: boolean;
    events?: boolean;
    metrics?: boolean;
    profiles?: boolean;
    mcpTools?: boolean;
  };
}

// Environment info for UI display
interface EnvironmentInfo {
  id: string;
  displayName: string;
  description?: string;
  isActive: boolean;
  configPath: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Agent Environment Command - Manage agent environments
 */
export const agentEnvCommand: Command = {
  name: "agent-env",
  displayName: "Agent Environment",
  description: "Manage agent environments (list, switch, create, update, delete)",
  hasArgs: false,

  async execute(context: CommandContext, args: string): Promise<CommandResult> {
    // Parse action
    let action: AgentEnvAction;
    try {
      action = args ? JSON.parse(args) : { type: "list" };
    } catch {
      return {
        success: false,
        message: "Invalid arguments",
        data: { error: "Invalid JSON" },
      };
    }

    switch (action.type) {
      case "list": {
        return await handleListAction();
      }

      case "select": {
        return await handleSelectAction(context, action);
      }

      case "create": {
        return await handleCreateAction(action);
      }

      case "update": {
        return await handleUpdateAction(action);
      }

      case "delete": {
        return await handleDeleteAction(action);
      }

      default:
        return {
          success: false,
          message: `Unknown action: ${(action as AgentEnvAction).type}`,
        };
    }
  },
};

/**
 * Handle list action - return all environments
 */
async function handleListAction(): Promise<CommandResult> {
  try {
    console.log("[AgentEnvCommand] handleListAction called");
    
    // Get current active environment
    const config = await Config_get();
    const activeEnv = config.activeEnvironment;
    console.log("[AgentEnvCommand] activeEnvironment:", activeEnv);

    // Scan environments directory
    const envsDir = ConfigPaths.environments;
    const environments: EnvironmentInfo[] = [];

    try {
      const entries = await fs.readdir(envsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const envConfigPath = path.join(envsDir, entry.name, "config.jsonc");
          try {
            const envConfig = await loadEnvironmentConfig(entry.name);
            const stat = await fs.stat(envConfigPath);
            
            environments.push({
              id: entry.name,
              displayName: envConfig?.environment?.displayName || entry.name,
              description: envConfig?.environment?.description,
              isActive: entry.name === activeEnv,
              configPath: envConfigPath,
              createdAt: stat.birthtime.toISOString(),
              updatedAt: stat.mtime.toISOString(),
            });
          } catch {
            // If can't read config, still list the directory
            environments.push({
              id: entry.name,
              displayName: entry.name,
              isActive: entry.name === activeEnv,
              configPath: envConfigPath,
            });
          }
        }
      }
    } catch {
      // Directory might not exist
    }

    console.log("[AgentEnvCommand] Returning list result:", { 
      envCount: environments.length, 
      activeEnv,
      success: true 
    });
    
    return {
      success: true,
      message: "Opening environment manager",
      data: {
        mode: "dialog",
        environments,
        activeEnvironment: activeEnv,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to list environments: ${error}`,
    };
  }
}

/**
 * Handle select action - switch to specified environment
 */
async function handleSelectAction(
  context: CommandContext,
  action: AgentEnvAction
): Promise<CommandResult> {
  if (!action.envName) {
    return {
      success: false,
      message: "Missing environment name",
      data: { error: "envName is required" },
    };
  }

  const envDir = path.join(ConfigPaths.environments, action.envName);
  
  try {
    // Check if environment exists
    await fs.access(envDir);
  } catch {
    return {
      success: false,
      message: `Environment "${action.envName}" not found`,
    };
  }

  try {
    // Update activeEnvironment in global config
    const globalConfigPath = path.join(ConfigPaths.config, "tong_work.jsonc");
    let globalConfig: any = {};
    
    try {
      const content = await fs.readFile(globalConfigPath, "utf-8");
      globalConfig = JSON.parse(content);
    } catch {
      // File might not exist
    }

    globalConfig.activeEnvironment = action.envName;
    
    await fs.writeFile(
      globalConfigPath,
      JSON.stringify(globalConfig, null, 2),
      "utf-8"
    );

    // If ServerEnvironment supports switchEnvironment, use it for hot reload
    // This is the preferred way as it updates both config registry and LLM config
    if (context.env && "switchEnvironment" in context.env) {
      try {
        const switched = await (context.env as any).switchEnvironment(action.envName, context);
        if (switched) {
          return {
            success: true,
            message: `Switched to environment: ${action.envName}`,
            data: {
              environment: action.envName,
              reloaded: true,
            },
          };
        }
      } catch (error) {
        console.warn("[AgentEnvCommand] switchEnvironment failed:", error);
      }
    }
    
    // Fallback: manually update config registry and reload
    // This happens when ServerEnvironment is not available (e.g., in tests)
    console.log("[AgentEnvCommand] Using fallback: manually updating config registry");
    
    // Update config registry: remove old environment sources and add new one
    const sources = configRegistry.getSources();
    for (const source of sources) {
      if (source.name.startsWith("environment:")) {
        configRegistry.unregister(source.name);
        console.log(`[AgentEnvCommand] Unregistered old environment source: ${source.name}`);
      }
    }
    
    // Register new environment source with higher priority
    const newEnvSource = createEnvironmentSource(action.envName, 10);
    configRegistry.register(newEnvSource);
    console.log(`[AgentEnvCommand] Registered new environment source: ${newEnvSource.name}`);

    // Reload configuration
    await Config_reload();

    return {
      success: true,
      message: `Switched to environment: ${action.envName}`,
      data: {
        environment: action.envName,
        reloaded: true,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to switch environment: ${error}`,
    };
  }
}

/**
 * Handle create action - create new environment
 */
async function handleCreateAction(action: AgentEnvAction): Promise<CommandResult> {
  if (!action.envName) {
    return {
      success: false,
      message: "Missing environment name",
    };
  }

  // Validate name (only letters, numbers, underscores, hyphens)
  if (!/^[a-zA-Z0-9_-]+$/.test(action.envName)) {
    return {
      success: false,
      message: "Invalid environment name. Use only letters, numbers, underscores, and hyphens.",
    };
  }

  const envDir = path.join(ConfigPaths.environments, action.envName);
  const configPath = path.join(envDir, "config.jsonc");

  try {
    // Check if already exists
    await fs.access(envDir);
    return {
      success: false,
      message: `Environment "${action.envName}" already exists`,
    };
  } catch {
    // Doesn't exist, continue creating
  }

  try {
    // Create directory
    await fs.mkdir(envDir, { recursive: true });

    // Create default config file
    const defaultConfig = {
      id: action.envName,
      displayName: action.config?.displayName || action.envName,
      description: action.config?.description || "",
      defaultModel: action.config?.defaultModel,
      baseURL: action.config?.baseURL,
      apiKey: action.config?.apiKey,
      capabilities: {
        logs: true,
        events: true,
        metrics: true,
        profiles: true,
        mcpTools: false,
      },
    };

    await fs.writeFile(
      configPath,
      JSON.stringify(defaultConfig, null, 2),
      "utf-8"
    );

    return {
      success: true,
      message: `Environment "${action.envName}" created successfully`,
      data: {
        environment: action.envName,
        path: envDir,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to create environment: ${error}`,
    };
  }
}

/**
 * Handle update action - update environment config
 */
async function handleUpdateAction(action: AgentEnvAction): Promise<CommandResult> {
  if (!action.envName) {
    return {
      success: false,
      message: "Missing environment name",
    };
  }

  const envDir = path.join(ConfigPaths.environments, action.envName);
  const configPath = path.join(envDir, "config.jsonc");

  try {
    // Read existing config
    const content = await fs.readFile(configPath, "utf-8");
    const existingConfig = JSON.parse(content);

    // Merge updates
    const updatedConfig = {
      ...existingConfig,
      ...action.config,
      id: action.envName, // ID cannot be changed
    };

    await fs.writeFile(
      configPath,
      JSON.stringify(updatedConfig, null, 2),
      "utf-8"
    );

    return {
      success: true,
      message: `Environment "${action.envName}" updated successfully`,
      data: {
        environment: action.envName,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to update environment: ${error}`,
    };
  }
}

/**
 * Handle delete action - delete environment
 */
async function handleDeleteAction(action: AgentEnvAction): Promise<CommandResult> {
  if (!action.envName) {
    return {
      success: false,
      message: "Missing environment name",
    };
  }

  // Check if it's the active environment
  const config = await Config_get();
  if (config.activeEnvironment === action.envName) {
    return {
      success: false,
      message: `Cannot delete the active environment. Please switch to another environment first.`,
    };
  }

  const envDir = path.join(ConfigPaths.environments, action.envName);

  try {
    // Recursively delete directory
    await fs.rm(envDir, { recursive: true, force: true });

    return {
      success: true,
      message: `Environment "${action.envName}" deleted successfully`,
      data: {
        environment: action.envName,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to delete environment: ${error}`,
    };
  }
}
