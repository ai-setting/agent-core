import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolveVariables, buildToolListDescription, buildEnvInfo } from "./variables.js";

describe("prompts/variables", () => {
  describe("resolveVariables", () => {
    it("should replace tool_list placeholder", () => {
      const content = "Available tools: {tool_list}";
      const result = resolveVariables(content, {
        toolList: "- bash: Execute shell commands",
        capabilities: "",
        envName: "os_env",
        agentId: "system",
        role: "system",
        envInfo: "",
      });
      expect(result).toBe("Available tools: - bash: Execute shell commands");
    });

    it("should replace env_name placeholder", () => {
      const content = "You are in {env_name}";
      const result = resolveVariables(content, {
        toolList: "",
        capabilities: "",
        envName: "web_env",
        agentId: "system",
        role: "system",
        envInfo: "",
      });
      expect(result).toBe("You are in web_env");
    });

    it("should replace agent_id placeholder", () => {
      const content = "Agent: {agent_id}";
      const result = resolveVariables(content, {
        toolList: "",
        capabilities: "",
        envName: "os_env",
        agentId: "coding-assistant",
        role: "system",
        envInfo: "",
      });
      expect(result).toBe("Agent: coding-assistant");
    });

    it("should replace role placeholder", () => {
      const content = "Role: {role}";
      const result = resolveVariables(content, {
        toolList: "",
        capabilities: "",
        envName: "os_env",
        agentId: "system",
        role: "sub",
        envInfo: "",
      });
      expect(result).toBe("Role: sub");
    });

    it("should replace env_info placeholder", () => {
      const content = "Info: {env_info}";
      const result = resolveVariables(content, {
        toolList: "",
        capabilities: "",
        envName: "os_env",
        agentId: "system",
        role: "system",
        envInfo: "Environment: os_env\nWorking directory: /home/user",
      });
      expect(result).toBe("Info: Environment: os_env\nWorking directory: /home/user");
    });

    it("should replace multiple placeholders", () => {
      const content = "{agent_id} in {env_name} using {role}";
      const result = resolveVariables(content, {
        toolList: "",
        capabilities: "",
        envName: "os_env",
        agentId: "explorer",
        role: "sub",
        envInfo: "",
      });
      expect(result).toBe("explorer in os_env using sub");
    });

    it("should handle empty placeholders gracefully", () => {
      const content = "Tools: {tool_list}";
      const result = resolveVariables(content, {
        toolList: "No tools available",
        capabilities: "",
        envName: "",
        agentId: "",
        role: "",
        envInfo: "",
      });
      expect(result).toBe("Tools: No tools available");
    });
  });

  describe("buildToolListDescription", () => {
    it("should build tool list from array", () => {
      const tools = [
        { name: "bash", description: "Execute shell commands" },
        { name: "read", description: "Read file contents" },
      ];
      const result = buildToolListDescription(tools);
      expect(result).toBe("- **bash**: Execute shell commands\n- **read**: Read file contents");
    });

    it("should handle empty tools array", () => {
      const result = buildToolListDescription([]);
      expect(result).toBe("No tools available");
    });

    it("should handle single tool", () => {
      const tools = [{ name: "todo", description: "Manage tasks" }];
      const result = buildToolListDescription(tools);
      expect(result).toBe("- **todo**: Manage tasks");
    });
  });

  describe("buildEnvInfo", () => {
    it("should build environment info", () => {
      const result = buildEnvInfo("os_env", "/home/user/project");
      expect(result).toContain("Environment: os_env");
      expect(result).toContain("Working directory: /home/user/project");
      expect(result).toContain("Platform:");
      expect(result).toContain("Today's date:");
    });

    it("should handle missing workdir", () => {
      const result = buildEnvInfo("web_env");
      expect(result).toContain("Environment: web_env");
      expect(result).toContain("Platform:");
    });

    it("should handle empty envName", () => {
      const result = buildEnvInfo("");
      expect(result).toContain("Platform:");
    });
  });
});
