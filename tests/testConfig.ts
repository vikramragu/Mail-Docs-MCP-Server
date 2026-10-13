import type { Config } from "../src/config.js";

export function makeTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    GOOGLE_CLIENT_ID: "test-client-id",
    GOOGLE_CLIENT_SECRET: "test-client-secret",
    GOOGLE_TOKEN_PATH: "/tmp/does-not-matter/token.json",
    ENABLE_GMAIL_SEND: true,
    ENABLE_GMAIL_DRAFTS: true,
    ENABLE_DOCS_APPEND: true,
    DRY_RUN: false,
    ALLOWED_RECIPIENT_DOMAINS: [],
    MAX_RECIPIENTS: 50,
    MAX_ATTACHMENT_MB: 20,
    ALLOWED_DOCUMENT_IDS: [],
    MCP_TRANSPORT: "stdio",
    MCP_HTTP_PORT: 8080,
    MCP_HTTP_HOST: "127.0.0.1",
    MCP_AUTH_TOKEN: undefined,
    MCP_ALLOWED_ORIGINS: [],
    LOG_LEVEL: "error",
    ...overrides,
  };
}
