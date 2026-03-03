import type { SandboxConfig } from "../types.js";
import type { ISandboxProvider } from "../types.js";
import { matchActionFilter } from "../sandbox-action-filter.js";

let SandboxManager: typeof import("@anthropic-ai/sandbox-runtime").SandboxManager | null = null;

async function getSandboxManager() {
  if (!SandboxManager) {
    try {
      const module = await import("@anthropic-ai/sandbox-runtime");
      SandboxManager = module.SandboxManager;
    } catch (error) {
      throw new Error(
        "Failed to import @anthropic-ai/sandbox-runtime. Please install it: bun add @anthropic-ai/sandbox-runtime"
      );
    }
  }
  return SandboxManager;
}

export class NativeSandboxProvider implements ISandboxProvider {
  readonly type = "native" as const;

  async initialize(config: SandboxConfig): Promise<void> {
    const sm = await getSandboxManager();

    if (sm.isSandboxingEnabled()) {
      return;
    }

    await sm.initialize({
      network: {
        allowedDomains: config?.network?.allowedDomains ?? [],
        deniedDomains: config?.network?.deniedDomains ?? [],
      },
      filesystem: {
        denyRead: config?.filesystem?.denyRead ?? [],
        allowWrite: config?.filesystem?.allowWrite ?? [],
        denyWrite: config?.filesystem?.denyWrite ?? [],
      },
    });
  }

  isInitialized(): boolean {
    if (!SandboxManager) {
      return false;
    }
    return SandboxManager.isSandboxingEnabled();
  }

  async wrapCommand(command: string): Promise<string> {
    const sm = await getSandboxManager();
    return sm.wrapWithSandbox(command);
  }

  shouldSandbox(actionName: string, config: SandboxConfig): boolean {
    if (!config?.enabled) {
      return false;
    }

    return matchActionFilter(actionName, config.actionFilter);
  }

  async cleanup(): Promise<void> {
    if (SandboxManager) {
      await SandboxManager.reset();
    }
  }
}
