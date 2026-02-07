/**
 * @fileoverview Agent Core HTTP Server
 * 
 * HTTP Server with SSE support for agent-core framework.
 * Based on Hono framework.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import eventsRoute from "./routes/events.js";
import sessionsRoute from "./routes/sessions.js";
import type { ServerEnvironment } from "./environment.js";

type Variables = {
  env: ServerEnvironment;
};

export interface ServerConfig {
  port?: number;
  hostname?: string;
  cors?: string[];
  env?: ServerEnvironment;
}

export class AgentServer {
  private app: Hono<{ Variables: Variables }>;
  private config: ServerConfig;
  private env?: ServerEnvironment;

  constructor(config: ServerConfig = {}) {
    this.config = {
      port: config.port || 3000,
      hostname: config.hostname || "0.0.0.0",
      cors: config.cors || ["*"],
    };
    this.env = config.env;

    this.app = new Hono();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // CORS
    this.app.use(cors({
      origin: this.config.cors || ["*"],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    }));

    // Logger
    this.app.use(logger());

    // Set environment in context
    this.app.use("/sessions/*", async (c, next) => {
      if (this.env) {
        c.set("env", this.env);
      }
      await next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get("/health", (c) => {
      return c.json({
        status: "ok",
        timestamp: Date.now(),
        version: "0.1.0",
      });
    });

    // SSE Events endpoint
    this.app.route("/events", eventsRoute);

    // Sessions API
    this.app.route("/sessions", sessionsRoute);

    // 404 handler
    this.app.notFound((c) => {
      return c.json({
        error: "Not Found",
        path: c.req.path,
        method: c.req.method,
      }, 404);
    });

    // Error handler
    this.app.onError((err, c) => {
      console.error("[Server Error]", err);
      return c.json({
        error: "Internal Server Error",
        message: err.message,
      }, 500);
    });
  }

  async start(): Promise<void> {
    const { port, hostname } = this.config;
    
    Bun.serve({
      port,
      hostname,
      fetch: this.app.fetch,
    });

    console.log(`🚀 Server running at http://${hostname}:${port}`);
    console.log(`📡 SSE endpoint: http://${hostname}:${port}/events`);
    console.log(`❤️  Health check: http://${hostname}:${port}/health`);
  }
}

// Export for use as module
export { Hono };
export * from "./eventbus/index.js";
export * from "./environment.js";
