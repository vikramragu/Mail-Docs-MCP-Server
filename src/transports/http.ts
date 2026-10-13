import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Config } from "../config.js";
import { createServer } from "../server.js";
import { logger } from "../logger.js";

const LOCALHOST_NAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/**
 * DNS-rebinding protection. `boundHost` is the address the process *binds*
 * to (e.g. 127.0.0.1 locally, 0.0.0.0 on a host like Railway) — it is NOT
 * the public hostname browsers see, so it can only be compared against the
 * Origin header when running on localhost. For a real public deployment,
 * `allowedOrigins` (MCP_ALLOWED_ORIGINS) must be set to the exact public
 * origin(s) expected (e.g. "https://your-app.up.railway.app"); otherwise
 * every request carrying an Origin header would be rejected once bound to
 * 0.0.0.0. Requests with no Origin header (non-browser MCP clients) are
 * always allowed through.
 */
function isOriginAllowed(origin: string | undefined, boundHost: string, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  if (allowedOrigins.length > 0) {
    return allowedOrigins.some((allowed) => allowed.toLowerCase() === origin.toLowerCase());
  }
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
    if (!isOriginAllowed(req.headers.origin, config.MCP_HTTP_HOST, config.MCP_ALLOWED_ORIGINS)) {
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

  // Unauthenticated health check for platform load balancers (e.g. Railway),
  // registered before the auth/origin guards so it needs neither.
  app.get("/healthz", (_req, res) => {
    res.sendStatus(200);
  });

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
