import { z } from "zod";

export const PromptMetadataSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  variables: z.array(z.string()).optional(),
  role: z.enum(["system", "user", "assistant"]).optional(),
  version: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type PromptMetadata = z.infer<typeof PromptMetadataSchema>;

export interface PromptFile {
  metadata: PromptMetadata;
  content: string;
}

export interface ResolvedPrompt {
  id: string;
  content: string;
  role: "system" | "user" | "assistant";
  metadata: PromptMetadata;
}

export interface PromptContext {
  toolList: string;
  capabilities: string;
  envName: string;
  agentId: string;
  role: string;
  envInfo?: string;
}

export interface LoadedPrompt {
  id: string;
  content: string;
  metadata: PromptMetadata;
}
