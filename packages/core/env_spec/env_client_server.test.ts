import { describe, it, expect } from "bun:test";
import { EnvClient, type EnvRpcClient } from "./client.js";
import { createEnvMcpServer, type EnvMcpServerLike } from "./server.js";
import type { EnvDescription, EnvProfile, AgentSpec, LogEntry } from "./types.js";

class MockServer implements EnvMcpServerLike {
  public tools = new Map<string, (params: unknown) => Promise<unknown> | unknown>();
  tool(name: string, handler: (params: unknown) => Promise<unknown> | unknown): void {
    this.tools.set(name, handler);
  }
}

class MockRpcClient implements EnvRpcClient {
  constructor(
    private server: MockServer
  ) {}

  async call(method: string, params: unknown): Promise<unknown> {
    const handler = this.server.tools.get(method);
    if (!handler) {
      throw new Error(`No handler for method ${method}`);
    }
    return await handler(params);
  }
}

describe("EnvClient & EnvServer (in-memory integration)", () => {
  describe("getDescription", () => {
    it("should expose env/get_description and be consumable via EnvClient", async () => {
      const server = new MockServer();

      const description: EnvDescription = {
        id: "env-1",
        displayName: "Env One",
        version: "1.0.0",
        capabilities: {
          logs: true,
          events: true,
          profiles: true,
        },
        profiles: [],
      };

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => description,
      });

      const client = new EnvClient(new MockRpcClient(server));

      const got = await client.getDescription();
      expect(got.id).toBe("env-1");
      expect(got.displayName).toBe("Env One");
      expect(got.capabilities?.logs).toBe(true);
    });

    it("should support async describeEnv", async () => {
      const server = new MockServer();

      createEnvMcpServer(server, {} as any, {
        describeEnv: async () => ({
          id: "async-env",
          displayName: "Async Env",
          version: "2.0.0",
        }),
      });

      const client = new EnvClient(new MockRpcClient(server));
      const got = await client.getDescription();
      expect(got.id).toBe("async-env");
    });
  });

  describe("profiles", () => {
    it("should list all profiles", async () => {
      const server = new MockServer();

      const profiles: EnvProfile[] = [
        {
          id: "default",
          displayName: "Default",
          primaryAgents: [],
        },
        {
          id: "advanced",
          displayName: "Advanced",
          primaryAgents: [],
        },
      ];

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        listProfiles: () => profiles,
      });

      const client = new EnvClient(new MockRpcClient(server));
      const listed = await client.listProfiles();
      expect(listed.length).toBe(2);
      expect(listed[0].id).toBe("default");
      expect(listed[1].id).toBe("advanced");
    });

    it("should get profile by id", async () => {
      const server = new MockServer();

      const profiles: EnvProfile[] = [
        {
          id: "default",
          displayName: "Default Profile",
          primaryAgents: [
            {
              id: "coding-assistant",
              role: "primary",
              promptId: "system:coding",
              allowedTools: ["bash", "file_read"],
            },
          ],
        },
      ];

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        listProfiles: () => profiles,
      });

      const client = new EnvClient(new MockRpcClient(server));
      const profile = await client.getProfile("default");
      expect(profile.displayName).toBe("Default Profile");
      expect(profile.primaryAgents[0].id).toBe("coding-assistant");
    });

    it("should throw error when profile not found", async () => {
      const server = new MockServer();

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        listProfiles: () => [],
      });

      const client = new EnvClient(new MockRpcClient(server));
      await expect(client.getProfile("nonexistent")).rejects.toThrow("Profile not found: nonexistent");
    });
  });

  describe("agents", () => {
    it("should list all agents", async () => {
      const server = new MockServer();

      const agents: AgentSpec[] = [
        {
          id: "coding-assistant",
          role: "primary",
          promptId: "system:coding",
          allowedTools: ["bash", "file_read"],
        },
        {
          id: "reviewer",
          role: "sub",
          promptId: "system:review",
          allowedTools: ["file_read"],
        },
      ];

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        listAgents: () => agents,
      });

      const client = new EnvClient(new MockRpcClient(server));
      const listed = await client.listAgents();
      expect(listed.length).toBe(2);
      expect(listed[0].id).toBe("coding-assistant");
      expect(listed[1].id).toBe("reviewer");
    });

    it("should list agents with role filter", async () => {
      const server = new MockServer();

      const agents: AgentSpec[] = [
        {
          id: "coding-assistant",
          role: "primary",
          promptId: "system:coding",
          allowedTools: ["bash"],
        },
        {
          id: "reviewer",
          role: "sub",
          promptId: "system:review",
          allowedTools: ["file_read"],
        },
      ];

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        listAgents: (params) => {
          if (params?.role === "primary") {
            return agents.filter((a) => a.role === "primary");
          }
          return agents;
        },
      });

      const client = new EnvClient(new MockRpcClient(server));
      const primaryAgents = await client.listAgents({ role: "primary" });
      expect(primaryAgents.length).toBe(1);
      expect(primaryAgents[0].role).toBe("primary");
    });

    it("should get agent by id", async () => {
      const server = new MockServer();

      const agents: AgentSpec[] = [
        {
          id: "coding-assistant",
          role: "primary",
          promptId: "system:coding",
          allowedTools: ["bash", "file_read"],
        },
      ];

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        listAgents: () => agents,
        getAgent: (id) => {
          const agent = agents.find((a) => a.id === id);
          if (!agent) throw new Error(`Agent not found: ${id}`);
          return agent;
        },
      });

      const client = new EnvClient(new MockRpcClient(server));
      const agent = await client.getAgent("coding-assistant");
      expect(agent.id).toBe("coding-assistant");
      expect(agent.promptId).toBe("system:coding");
    });

    it("should get agent with profileId", async () => {
      const server = new MockServer();

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        getAgent: (id, profileId) => ({
          id,
          role: "primary",
          promptId: `profile:${profileId}:system:coding`,
          allowedTools: ["bash"],
        }),
      });

      const client = new EnvClient(new MockRpcClient(server));
      const agent = await client.getAgent("coding-assistant", "dev-profile");
      expect(agent.promptId).toBe("profile:dev-profile:system:coding");
    });
  });

  describe("logs", () => {
    it("should query logs without filters", async () => {
      const server = new MockServer();

      const logs: LogEntry[] = [
        {
          timestamp: new Date().toISOString(),
          level: "info",
          message: "test log",
          sessionId: "s1",
        },
      ];

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env-logs", displayName: "Env with logs" }),
        queryLogs: () => logs,
      });

      const client = new EnvClient(new MockRpcClient(server));
      const gotLogs = await client.queryLogs({});
      expect(gotLogs.length).toBe(1);
      expect(gotLogs[0].message).toBe("test log");
    });

    it("should query logs with sessionId filter", async () => {
      const server = new MockServer();

      const allLogs: LogEntry[] = [
        { timestamp: "2024-01-01", level: "info", message: "log1", sessionId: "s1" },
        { timestamp: "2024-01-02", level: "info", message: "log2", sessionId: "s2" },
      ];

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        queryLogs: (params) => {
          if (params.sessionId) {
            return allLogs.filter((l) => l.sessionId === params.sessionId);
          }
          return allLogs;
        },
      });

      const client = new EnvClient(new MockRpcClient(server));
      const filtered = await client.queryLogs({ sessionId: "s1" });
      expect(filtered.length).toBe(1);
      expect(filtered[0].message).toBe("log1");
    });

    it("should query logs with level filter", async () => {
      const server = new MockServer();

      const allLogs: LogEntry[] = [
        { timestamp: "2024-01-01", level: "info", message: "info log" },
        { timestamp: "2024-01-02", level: "error", message: "error log" },
        { timestamp: "2024-01-03", level: "warn", message: "warn log" },
      ];

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        queryLogs: (params) => {
          if (params.level) {
            return allLogs.filter((l) => l.level === params.level);
          }
          return allLogs;
        },
      });

      const client = new EnvClient(new MockRpcClient(server));
      const errors = await client.queryLogs({ level: "error" });
      expect(errors.length).toBe(1);
      expect(errors[0].message).toBe("error log");
    });

    it("should query logs with time range", async () => {
      const server = new MockServer();

      const allLogs: LogEntry[] = [
        { timestamp: "2024-01-01T00:00:00Z", level: "info", message: "old log" },
        { timestamp: "2024-06-01T00:00:00Z", level: "info", message: "mid log" },
        { timestamp: "2024-12-01T00:00:00Z", level: "info", message: "new log" },
      ];

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        queryLogs: (params) => {
          return allLogs.filter((l) => {
            if (params.since && l.timestamp < params.since) return false;
            if (params.until && l.timestamp > params.until) return false;
            return true;
          });
        },
      });

      const client = new EnvClient(new MockRpcClient(server));
      const midLogs = await client.queryLogs({ 
        since: "2024-03-01T00:00:00Z",
        until: "2024-09-01T00:00:00Z"
      });
      expect(midLogs.length).toBe(1);
      expect(midLogs[0].message).toBe("mid log");
    });

    it("should query logs with limit", async () => {
      const server = new MockServer();

      const allLogs: LogEntry[] = [
        { timestamp: "2024-01-01", level: "info", message: "log1" },
        { timestamp: "2024-01-02", level: "info", message: "log2" },
        { timestamp: "2024-01-03", level: "info", message: "log3" },
      ];

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        queryLogs: (params) => {
          let logs = allLogs;
          if (params.limit) {
            logs = logs.slice(0, params.limit);
          }
          return logs;
        },
      });

      const client = new EnvClient(new MockRpcClient(server));
      const limited = await client.queryLogs({ limit: 2 });
      expect(limited.length).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("should handle empty profiles list", async () => {
      const server = new MockServer();

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        listProfiles: () => [],
      });

      const client = new EnvClient(new MockRpcClient(server));
      const profiles = await client.listProfiles();
      expect(profiles).toEqual([]);
    });

    it("should handle empty agents list", async () => {
      const server = new MockServer();

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        listAgents: () => [],
      });

      const client = new EnvClient(new MockRpcClient(server));
      const agents = await client.listAgents();
      expect(agents).toEqual([]);
    });

    it("should handle empty logs", async () => {
      const server = new MockServer();

      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
        queryLogs: () => [],
      });

      const client = new EnvClient(new MockRpcClient(server));
      const logs = await client.queryLogs({});
      expect(logs).toEqual([]);
    });

    it("should throw error when calling unregistered tool", async () => {
      const server = new MockServer();

      // 只注册 describeEnv，不注册 listProfiles
      createEnvMcpServer(server, {} as any, {
        describeEnv: () => ({ id: "env", displayName: "Env" }),
      });

      const client = new EnvClient(new MockRpcClient(server));
      await expect(client.listProfiles()).rejects.toThrow("No handler for method env/list_profiles");
    });
  });
});
