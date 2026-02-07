/**
 * @fileoverview Provider and Model definitions.
 */

export interface ProviderModelCapabilities {
  temperature: boolean;
  reasoning: boolean;
  toolcall: boolean;
  input: {
    text: boolean;
    audio: boolean;
    image: boolean;
    video: boolean;
    pdf: boolean;
  };
  output: {
    text: boolean;
    audio: boolean;
    image: boolean;
    video: boolean;
    pdf: boolean;
  };
}

export interface ProviderModelCost {
  input: number;
  output: number;
  cache?: {
    read: number;
    write: number;
  };
}

export interface ProviderModelLimit {
  context: number;
  output: number;
}

export interface ProviderModel {
  id: string;
  providerID: string;
  name: string;
  family?: string;
  api: {
    id: string;
    url: string;
    npm: string;
  };
  capabilities: ProviderModelCapabilities;
  cost: ProviderModelCost;
  limit: ProviderModelLimit;
  status: "alpha" | "beta" | "deprecated" | "active";
  options?: Record<string, unknown>;
  headers?: Record<string, string>;
  release_date?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  source: "env" | "config" | "custom" | "bundled";
  envVars?: string[];
  apiKey?: string;
  options?: Record<string, unknown>;
  models: Record<string, ProviderModel>;
}

export interface ProviderSDK {
  languageModel(modelID: string): unknown;
}

export interface ProviderFactory {
  (options: Record<string, unknown>): unknown;
}
