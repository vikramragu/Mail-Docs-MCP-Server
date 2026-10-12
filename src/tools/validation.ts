import { z } from "zod";
import type { Config } from "../config.js";
import { RecipientDomainError, AttachmentTooLargeError, ValidationError, DocumentAllowlistError } from "../errors.js";

// RFC 5322-lite: good enough to catch typos without the portability problems
// of zod's built-in `.email()`, which emits a JSON Schema `format` keyword
// that some MCP clients reject (see problemStatement.md §7).
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  if (/[\r\n]/.test(value)) return false;
  return EMAIL_RE.test(value);
}

/**
 * Returns a *fresh* schema instance each call. zod-to-json-schema emits a
 * `$ref` whenever the same schema object is reused by reference across a
 * definition tree (e.g. for both `to` and `cc`), which problemStatement.md
 * §7 explicitly disallows — so every field needs its own instance.
 */
export function emailField() {
  return z.string().refine(isValidEmail, { message: "Invalid email address" });
}

export function assertNoHeaderInjection(field: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new ValidationError(`Invalid ${field}: contains CR/LF`);
  }
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

export function assertRecipientsAllowed(config: Config, recipients: string[]): void {
  if (config.ALLOWED_RECIPIENT_DOMAINS.length === 0) return;
  const allowed = new Set(config.ALLOWED_RECIPIENT_DOMAINS.map((d) => d.toLowerCase()));
  for (const recipient of recipients) {
    if (!allowed.has(domainOf(recipient))) {
      throw new RecipientDomainError(`Recipient domain not allowed: ${recipient}`);
    }
  }
}

export function assertRecipientCount(config: Config, recipients: string[]): void {
  if (recipients.length > config.MAX_RECIPIENTS) {
    throw new ValidationError(`Too many recipients: ${recipients.length} exceeds the configured maximum of ${config.MAX_RECIPIENTS}.`);
  }
}

/** Estimates decoded byte length from a base64 string without allocating a full Buffer. */
export function base64ByteLength(base64: string): number {
  const cleaned = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  if (cleaned.length === 0) return 0;
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  return Math.floor((cleaned.length * 3) / 4) - padding;
}

export function assertAttachmentsWithinLimit(config: Config, attachments: { content_base64: string }[]): void {
  const totalBytes = attachments.reduce((sum, a) => sum + base64ByteLength(a.content_base64), 0);
  const maxBytes = config.MAX_ATTACHMENT_MB * 1024 * 1024;
  if (totalBytes > maxBytes) {
    throw new AttachmentTooLargeError(config.MAX_ATTACHMENT_MB);
  }
}

export function assertDocumentAllowed(config: Config, documentId: string): void {
  if (config.ALLOWED_DOCUMENT_IDS.length === 0) return;
  if (!config.ALLOWED_DOCUMENT_IDS.includes(documentId)) {
    throw new DocumentAllowlistError();
  }
}
