import { z } from "zod";

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const envSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  GOOGLE_TOKEN_PATH: z.string().default("~/.config/google-workspace-mcp/token.json"),

  ENABLE_GMAIL_SEND: z.boolean().default(true),
  ENABLE_GMAIL_DRAFTS: z.boolean().default(true),
  ENABLE_DOCS_APPEND: z.boolean().default(true),

  DRY_RUN: z.boolean().default(false),
  ALLOWED_RECIPIENT_DOMAINS: z.array(z.string()).default([]),
  MAX_RECIPIENTS: z.number().int().positive().default(50),
  MAX_ATTACHMENT_MB: z.number().int().positive().default(20),
  ALLOWED_DOCUMENT_IDS: z.array(z.string()).default([]),

  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  MCP_HTTP_PORT: z.number().int().positive().default(8080),
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  MCP_AUTH_TOKEN: z.string().optional(),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof envSchema>;

export interface CliOverrides {
  transport?: "stdio" | "http";
  port?: number;
  host?: string;
}

/**
 * CLI flags win over env vars; env vars win over schema defaults.
 * `GOOGLE_CLIENT_ID`/`SECRET` are required even when DRY_RUN is set, since
 * the OAuth client is constructed unconditionally (auth only hits the
 * network when a tool actually calls Google).
 */
export function loadConfig(overrides: CliOverrides = {}): Config {
  const raw = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "",
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "",
    GOOGLE_TOKEN_PATH: process.env.GOOGLE_TOKEN_PATH || undefined,

    ENABLE_GMAIL_SEND: parseBool(process.env.ENABLE_GMAIL_SEND, true),
    ENABLE_GMAIL_DRAFTS: parseBool(process.env.ENABLE_GMAIL_DRAFTS, true),
    ENABLE_DOCS_APPEND: parseBool(process.env.ENABLE_DOCS_APPEND, true),

    DRY_RUN: parseBool(process.env.DRY_RUN, false),
    ALLOWED_RECIPIENT_DOMAINS: parseList(process.env.ALLOWED_RECIPIENT_DOMAINS),
    MAX_RECIPIENTS: process.env.MAX_RECIPIENTS ? Number(process.env.MAX_RECIPIENTS) : undefined,
    MAX_ATTACHMENT_MB: process.env.MAX_ATTACHMENT_MB ? Number(process.env.MAX_ATTACHMENT_MB) : undefined,
    ALLOWED_DOCUMENT_IDS: parseList(process.env.ALLOWED_DOCUMENT_IDS),

    MCP_TRANSPORT: overrides.transport ?? process.env.MCP_TRANSPORT ?? undefined,
    MCP_HTTP_PORT: overrides.port ?? (process.env.MCP_HTTP_PORT ? Number(process.env.MCP_HTTP_PORT) : undefined),
    MCP_HTTP_HOST: overrides.host ?? process.env.MCP_HTTP_HOST ?? undefined,
    MCP_AUTH_TOKEN: process.env.MCP_AUTH_TOKEN || undefined,

    LOG_LEVEL: process.env.LOG_LEVEL ?? undefined,
  };

  // Strip undefined so zod defaults apply.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));

  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  return result.data;
}
