/**
 * Typed error classes that map 1:1 to the tool-result error messages in
 * problemStatement.md §10. Thrown from services/tools and caught at the
 * tool-call boundary (see tools/toolResult.ts) to become `isError: true`
 * MCP results rather than protocol-level crashes.
 */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends McpToolError {}

export class RecipientDomainError extends McpToolError {}

export class AuthRequiredError extends McpToolError {
  constructor() {
    super("Google authorization required. Run `npm run auth`.");
  }
}

export class InsufficientScopeError extends McpToolError {
  constructor(detail: string) {
    super(`Missing permission scope: ${detail}. Re-authorize.`);
  }
}

export class DocumentNotFoundError extends McpToolError {
  constructor() {
    super("Document not found or not shared with this account.");
  }
}

export class DocumentAccessError extends McpToolError {
  constructor() {
    super("No edit access to this document.");
  }
}

export class GoogleUnavailableError extends McpToolError {
  constructor() {
    super("Google API temporarily unavailable.");
  }
}

export class AttachmentTooLargeError extends McpToolError {
  constructor(maxMb: number) {
    super(`Attachments exceed ${maxMb} MB.`);
  }
}

export class FeatureDisabledError extends McpToolError {
  constructor(feature: string) {
    super(`Feature disabled by server configuration: ${feature}.`);
  }
}

export class DocumentAllowlistError extends McpToolError {
  constructor() {
    super("Document is not on the configured allowlist.");
  }
}

export type GoogleErrorContext = "generic" | "documents";

/**
 * Translates a raw Google API error (googleapis throws GaxiosError-shaped
 * objects with a numeric `.code` or `.response.status`) into one of our
 * typed errors. `context: "documents"` applies the Docs-specific §10 wording
 * for 403/404 ("No edit access to this document." / "Document not found...")
 * — those messages would be misleading for a Gmail-sourced error, so Gmail
 * call sites use the generic (default) context instead.
 */
export function classifyGoogleError(err: unknown, context: GoogleErrorContext = "generic"): McpToolError {
  const status = extractStatus(err);
  if (status === 401) return new AuthRequiredError();
  if (status === 403) {
    const message = extractMessage(err);
    if (/insufficient|scope/i.test(message)) {
      return new InsufficientScopeError(message);
    }
    return context === "documents" ? new DocumentAccessError() : new McpToolError(message || "Permission denied.");
  }
  if (status === 404) {
    return context === "documents" ? new DocumentNotFoundError() : new McpToolError(extractMessage(err) || "Not found.");
  }
  if (status === 429 || (status !== undefined && status >= 500)) return new GoogleUnavailableError();
  if (err instanceof McpToolError) return err;
  return new McpToolError(extractMessage(err) || "Unknown error");
}

function extractStatus(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const anyErr = err as { code?: unknown; status?: unknown; response?: { status?: unknown } };
    const candidates = [anyErr.code, anyErr.status, anyErr.response?.status];
    for (const candidate of candidates) {
      const num = typeof candidate === "string" ? Number(candidate) : candidate;
      if (typeof num === "number" && !Number.isNaN(num)) return num;
    }
  }
  return undefined;
}

function extractMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "";
}

export async function withGoogleRetry<T>(fn: () => Promise<T>, maxRetries = 3, context: GoogleErrorContext = "generic"): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const status = extractStatus(err);
      const retryable = status === 429 || (status !== undefined && status >= 500);
      attempt += 1;
      if (!retryable || attempt > maxRetries) {
        throw classifyGoogleError(err, context);
      }
      const backoffMs = 2 ** attempt * 100 + Math.random() * 100;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
}
