import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../../src/config.js";

const ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_TOKEN_PATH",
  "ENABLE_GMAIL_SEND",
  "ENABLE_GMAIL_DRAFTS",
  "ENABLE_DOCS_APPEND",
  "DRY_RUN",
  "ALLOWED_RECIPIENT_DOMAINS",
  "MAX_RECIPIENTS",
  "MAX_ATTACHMENT_MB",
  "ALLOWED_DOCUMENT_IDS",
  "MCP_TRANSPORT",
  "MCP_HTTP_PORT",
  "MCP_HTTP_HOST",
  "MCP_AUTH_TOKEN",
  "MCP_ALLOWED_ORIGINS",
  "LOG_LEVEL",
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("loadConfig", () => {
  it("throws a clear error when required credentials are missing", () => {
    expect(() => loadConfig()).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it("applies documented defaults", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    const config = loadConfig();
    expect(config.ENABLE_GMAIL_SEND).toBe(true);
    expect(config.DRY_RUN).toBe(false);
    expect(config.MAX_RECIPIENTS).toBe(50);
    expect(config.MAX_ATTACHMENT_MB).toBe(20);
    expect(config.MCP_TRANSPORT).toBe("stdio");
    expect(config.MCP_HTTP_PORT).toBe(8080);
    expect(config.MCP_HTTP_HOST).toBe("127.0.0.1");
    expect(config.ALLOWED_RECIPIENT_DOMAINS).toEqual([]);
    expect(config.ALLOWED_DOCUMENT_IDS).toEqual([]);
    expect(config.MCP_ALLOWED_ORIGINS).toEqual([]);
  });

  it("parses MCP_ALLOWED_ORIGINS as a comma-separated list", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.MCP_ALLOWED_ORIGINS = "https://a.example.com, https://b.example.com";
    const config = loadConfig();
    expect(config.MCP_ALLOWED_ORIGINS).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("parses comma-separated allowlists, trimming whitespace", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.ALLOWED_RECIPIENT_DOMAINS = "company.com, partner.com ,  other.org";
    const config = loadConfig();
    expect(config.ALLOWED_RECIPIENT_DOMAINS).toEqual(["company.com", "partner.com", "other.org"]);
  });

  it("parses boolean env vars case-insensitively", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.DRY_RUN = "TRUE";
    process.env.ENABLE_GMAIL_DRAFTS = "0";
    const config = loadConfig();
    expect(config.DRY_RUN).toBe(true);
    expect(config.ENABLE_GMAIL_DRAFTS).toBe(false);
  });

  it("CLI overrides win over env vars for transport/port/host", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.MCP_TRANSPORT = "stdio";
    process.env.MCP_HTTP_PORT = "9000";
    const config = loadConfig({ transport: "http", port: 8123, host: "0.0.0.0" });
    expect(config.MCP_TRANSPORT).toBe("http");
    expect(config.MCP_HTTP_PORT).toBe(8123);
    expect(config.MCP_HTTP_HOST).toBe("0.0.0.0");
  });

  it("rejects an invalid MCP_TRANSPORT value", () => {
    process.env.GOOGLE_CLIENT_ID = "id";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    process.env.MCP_TRANSPORT = "carrier-pigeon";
    expect(() => loadConfig()).toThrow(/Invalid configuration/);
  });
});
