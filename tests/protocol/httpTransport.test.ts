import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { buildHttpApp } from "../../src/transports/http.js";
import { makeTestConfig } from "../testConfig.js";

const AUTH_TOKEN = "test-token-123";
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = buildHttpApp(makeTestConfig({ MCP_AUTH_TOKEN: AUTH_TOKEN, DRY_RUN: true }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/mcp`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const MCP_HEADERS = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };

function rpc(method: string, params?: Record<string, unknown>, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

/** The Streamable HTTP transport may respond as SSE (`event:`/`data:` lines) even for a single reply. */
async function readJsonRpcResponse(res: Response): Promise<{ result?: { [k: string]: unknown }; error?: unknown }> {
  const text = await res.text();
  const dataLine = text
    .split("\n")
    .find((line) => line.startsWith("data:"));
  const jsonText = dataLine ? dataLine.slice("data:".length).trim() : text;
  return JSON.parse(jsonText);
}

describe("HTTP transport (§8.2 / §6 §12)", () => {
  it("rejects requests without a bearer token", async () => {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: MCP_HEADERS,
      body: JSON.stringify(rpc("tools/list")),
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests with the wrong bearer token", async () => {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: "Bearer wrong-token" },
      body: JSON.stringify(rpc("tools/list")),
    });
    expect(res.status).toBe(401);
  });

  it("rejects requests from a disallowed Origin (DNS-rebinding protection)", async () => {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${AUTH_TOKEN}`, Origin: "https://evil.example.com" },
      body: JSON.stringify(rpc("tools/list")),
    });
    expect(res.status).toBe(403);
  });

  it("accepts a request with no Origin header (non-browser client) and a valid bearer token", async () => {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${AUTH_TOKEN}` },
      body: JSON.stringify(
        rpc("initialize", {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1.0.0" },
        }),
      ),
    });
    expect(res.status).toBe(200);
    const body = await readJsonRpcResponse(res);
    expect((body.result?.serverInfo as { name: string }).name).toBe("google-workspace-mcp");
  });

  it("serves tools/list over a fresh stateless request and includes the expected tools", async () => {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${AUTH_TOKEN}` },
      body: JSON.stringify(rpc("tools/list")),
    });
    expect(res.status).toBe(200);
    const body = await readJsonRpcResponse(res);
    const names = (body.result?.tools as { name: string }[]).map((t) => t.name).sort();
    expect(names).toContain("gmail_send_email");
    expect(names).toContain("docs_append_content");
  });

  it("does not include a session id header in stateless mode", async () => {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${AUTH_TOKEN}` },
      body: JSON.stringify(rpc("tools/list")),
    });
    expect(res.headers.get("mcp-session-id")).toBeNull();
  });

  it("returns 405 for GET /mcp (no server-initiated stream in stateless mode)", async () => {
    const res = await fetch(baseUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${AUTH_TOKEN}`, Accept: "text/event-stream" },
    });
    expect(res.status).toBe(405);
  });

  it("serves GET /healthz with no auth required", async () => {
    const res = await fetch(baseUrl.replace("/mcp", "/healthz"));
    expect(res.status).toBe(200);
  });
});

describe("HTTP transport — MCP_ALLOWED_ORIGINS (public deployment, e.g. Railway)", () => {
  let publicServer: Server;
  let publicBaseUrl: string;

  beforeAll(async () => {
    // Simulates binding to 0.0.0.0 (as a real public deployment must) with an
    // explicit public-origin allowlist, per deployment-plan.md §0.1 — without
    // this, isOriginAllowed's old localhost-only fallback would reject every
    // request carrying an Origin header once MCP_HTTP_HOST isn't localhost.
    const app = buildHttpApp(
      makeTestConfig({
        MCP_AUTH_TOKEN: AUTH_TOKEN,
        DRY_RUN: true,
        MCP_HTTP_HOST: "0.0.0.0",
        MCP_ALLOWED_ORIGINS: ["https://my-app.up.railway.app"],
      }),
    );
    await new Promise<void>((resolve) => {
      publicServer = app.listen(0, "127.0.0.1", () => resolve());
    });
    const address = publicServer.address();
    const port = typeof address === "object" && address ? address.port : 0;
    publicBaseUrl = `http://127.0.0.1:${port}/mcp`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => publicServer.close(() => resolve()));
  });

  it("accepts a request whose Origin is on the allowlist", async () => {
    const res = await fetch(publicBaseUrl, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${AUTH_TOKEN}`, Origin: "https://my-app.up.railway.app" },
      body: JSON.stringify(rpc("tools/list")),
    });
    expect(res.status).toBe(200);
  });

  it("rejects a request whose Origin is not on the allowlist", async () => {
    const res = await fetch(publicBaseUrl, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${AUTH_TOKEN}`, Origin: "https://evil.example.com" },
      body: JSON.stringify(rpc("tools/list")),
    });
    expect(res.status).toBe(403);
  });

  it("still accepts a request with no Origin header at all", async () => {
    const res = await fetch(publicBaseUrl, {
      method: "POST",
      headers: { ...MCP_HEADERS, Authorization: `Bearer ${AUTH_TOKEN}` },
      body: JSON.stringify(rpc("tools/list")),
    });
    expect(res.status).toBe(200);
  });
});
