import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "../config.js";
import { createServer } from "../server.js";
import { logger } from "../logger.js";

const LOCALHOST_NAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * DNS-rebinding protection: if we're bound to a localhost address, only
 * accept requests whose Origin also resolves to localhost. Requests with no
 * Origin header (non-browser MCP clients) are allowed through.
 */
function isOriginAllowed(origin: string | undefined, boundHost: string): boolean {
  if (!origin) return true;
  try {
    const originHost = new URL(origin).hostname;
    if (LOCALHOST_NAMES.has(boundHost)) {
      return LOCALHOST_NAMES.has(originHost);
    }
    return originHost === boundHost;
  } catch {
    return false;
  }
}

function originGuard(config: Config) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isOriginAllowed(req.headers.origin, config.MCP_HTTP_HOST)) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    next();
  };
}

function bearerAuthGuard(config: Config) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const expected = `Bearer ${config.MCP_AUTH_TOKEN}`;
    if (req.headers.authorization !== expected) {
      res.status(401).json({ error: "Missing or invalid bearer token" });
      return;
    }
    next();
  };
}

export function buildHttpApp(config: Config): Express {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use(originGuard(config));
  app.use(bearerAuthGuard(config));

  // Stateless mode: a fresh server + transport per request, per the MCP SDK's
  // documented pattern for load-balanced / serverless deployments.
  app.post("/mcp", async (req, res) => {
    const server = createServer(config);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error("Error handling MCP HTTP request", { error: err instanceof Error ? err.message : String(err) });
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "Stateless mode: GET /mcp (server-initiated streams) is not supported." });
  });

  return app;
}

export async function runHttpTransport(config: Config): Promise<void> {
  if (!config.MCP_AUTH_TOKEN) {
    throw new Error("MCP_AUTH_TOKEN must be set to run the HTTP transport.");
  }
  const app = buildHttpApp(config);
  await new Promise<void>((resolve) => {
    app.listen(config.MCP_HTTP_PORT, config.MCP_HTTP_HOST, () => {
      logger.info(`MCP server listening on http://${config.MCP_HTTP_HOST}:${config.MCP_HTTP_PORT}/mcp`);
      resolve();
    });
  });
}
