import type { PromptContext } from "./types.js";

export function resolveVariables(content: string, context: PromptContext): string {
  return content
    .replace(/{tool_list}/g, context.toolList || "No tools available")
    .replace(/{agent_capabilities}/g, context.capabilities || "No specific capabilities")
    .replace(/{env_name}/g, context.envName || "unknown")
    .replace(/{agent_id}/g, context.agentId || "unknown")
    .replace(/{role}/g, context.role || "primary")
    .replace(/{env_info}/g, context.envInfo || "");
}

export function buildToolListDescription(tools: { name: string; description: string }[]): string {
  if (tools.length === 0) {
    return "No tools available";
  }
  
  const lines = tools.map((t) => `- **${t.name}**: ${t.description}`);
  return lines.join("\n");
}

export function buildEnvInfo(envName: string, workdir?: string): string {
  const parts: string[] = [];
  
  if (envName) {
    parts.push(`Environment: ${envName}`);
  }
  
  if (workdir) {
    parts.push(`Working directory: ${workdir}`);
  }
  
  parts.push(`Platform: ${typeof process !== "undefined" ? process.platform : "unknown"}`);
  
  if (typeof process !== "undefined") {
    parts.push(`Today's date: ${new Date().toISOString().split("T")[0]}`);
  }
  
  return parts.join("\n");
}
