import { z } from "zod";

export type SandboxType = "native" | "docker";

export interface SandboxActionFilterConfig {
  include?: string[];
  exclude?: string[];
}

const SandboxFilesystemConfig = z.object({
  denyRead: z.array(z.string()).optional(),
  allowWrite: z.array(z.string()).optional(),
  denyWrite: z.array(z.string()).optional(),
});

const SandboxNetworkConfig = z.object({
  allowedDomains: z.array(z.string()).optional(),
  deniedDomains: z.array(z.string()).optional(),
});

const SandboxDockerConfig = z.object({
  image: z.string().optional(),
  networkMode: z.enum(["bridge", "host", "none"]).optional(),
  volumes: z.record(z.string(), z.string()).optional(),
});

const SandboxActionFilterConfigSchema = z.object({
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
});

export const SandboxConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  type: z.enum(["native", "docker"]).default("native"),
  actionFilter: SandboxActionFilterConfigSchema.optional(),
  filesystem: SandboxFilesystemConfig.optional(),
  network: SandboxNetworkConfig.optional(),
  docker: SandboxDockerConfig.optional(),
});

export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;

export interface ISandboxProvider {
  readonly type: SandboxType;
  
  initialize(config: SandboxConfig): Promise<void>;
  
  isInitialized(): boolean;
  
  wrapCommand(command: string): Promise<string>;
  
  shouldSandbox(actionName: string, config: SandboxConfig): boolean;
  
  cleanup(): Promise<void>;
}

export interface ISandboxProviderFactory {
  create(type: SandboxType): ISandboxProvider;
}
