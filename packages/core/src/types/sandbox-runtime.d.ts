declare module "@anthropic-ai/sandbox-runtime" {
  export interface SandboxRuntimeConfig {
    network?: {
      allowedDomains?: string[];
      deniedDomains?: string[];
    };
    filesystem?: {
      denyRead?: string[];
      allowWrite?: string[];
      denyWrite?: string[];
    };
  }

  export interface SandboxDependencyCheck {
    errors: string[];
    warnings: string[];
  }

  export const SandboxManager: {
    initialize(config: SandboxRuntimeConfig): Promise<void>;
    isSupportedPlatform(): boolean;
    isSandboxingEnabled(): boolean;
    checkDependencies(ripgrepConfig?: { command: string; args?: string[] }): SandboxDependencyCheck;
    wrapWithSandbox(command: string, binShell?: string, customConfig?: Partial<SandboxRuntimeConfig>, abortSignal?: AbortSignal): Promise<string>;
    cleanupAfterCommand(): void;
    reset(): Promise<void>;
    getProxyPort(): number;
    getSocksProxyPort(): number;
  };
}
