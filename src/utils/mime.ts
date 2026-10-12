import { randomBytes } from "node:crypto";

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  /** Raw (not yet base64-encoded) attachment bytes. */
  contentBase64: string;
}

export interface MimeMessageInput {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  bodyFormat: "text" | "html";
  replyTo?: string;
  attachments?: MimeAttachment[];
}

const CRLF_RE = /[\r\n]/;

export class HeaderInjectionError extends Error {
  constructor(field: string) {
    super(`Invalid header value for "${field}": contains CR/LF`);
  }
}

function assertSafeHeader(field: string, value: string): void {
  if (CRLF_RE.test(value)) {
    throw new HeaderInjectionError(field);
  }
}

/** RFC 2047 "B" (base64) encoded-word, used when a header value is non-ASCII. */
export function encodeHeaderValue(value: string): string {
  assertSafeHeader("header", value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const encoded = Buffer.from(value, "utf-8").toString("base64");
  return `=?UTF-8?B?${encoded}?=`;
}

/** Minimal HTML → text fallback: strips tags and decodes common entities. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function boundary(): string {
  return `b${randomBytes(12).toString("hex")}`;
}

function base64Body(content: string): string {
  return Buffer.from(content, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n");
}

function bodyPart(contentType: string, content: string): string {
  return [`Content-Type: ${contentType}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", base64Body(content)].join("\r\n");
}

function attachmentPart(attachment: MimeAttachment): string {
  const encodedFilename = encodeHeaderValue(attachment.filename);
  const content = attachment.contentBase64.replace(/(.{76})/g, "$1\r\n");
  return [
    `Content-Type: ${attachment.mimeType}; name="${encodedFilename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${encodedFilename}"`,
    "",
    content,
  ].join("\r\n");
}

/**
 * Builds an RFC 2822 MIME message and returns it base64url-encoded, ready
 * for the Gmail API `raw` field.
 *
 * - text body, no attachments -> single text/plain part
 * - html body, no attachments -> multipart/alternative (text fallback + html)
 * - any body + attachments    -> multipart/mixed wrapping the above
 */
export function buildMimeMessage(input: MimeMessageInput): string {
  for (const addr of input.to) assertSafeHeader("to", addr);
  for (const addr of input.cc ?? []) assertSafeHeader("cc", addr);
  for (const addr of input.bcc ?? []) assertSafeHeader("bcc", addr);
  if (input.replyTo) assertSafeHeader("reply_to", input.replyTo);
  assertSafeHeader("subject", input.subject);

  const headers: string[] = ["MIME-Version: 1.0", `To: ${input.to.join(", ")}`];
  if (input.cc?.length) headers.push(`Cc: ${input.cc.join(", ")}`);
  if (input.bcc?.length) headers.push(`Bcc: ${input.bcc.join(", ")}`);
  if (input.replyTo) headers.push(`Reply-To: ${input.replyTo}`);
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);

  let bodySection: string;
  if (input.bodyFormat === "html") {
    const altBoundary = boundary();
    const textFallback = htmlToText(input.body);
    bodySection = [
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      "",
      `--${altBoundary}`,
      bodyPart("text/plain", textFallback),
      `--${altBoundary}`,
      bodyPart("text/html", input.body),
      `--${altBoundary}--`,
    ].join("\r\n");
  } else {
    bodySection = bodyPart("text/plain", input.body);
  }

  let message: string;
  if (input.attachments && input.attachments.length > 0) {
    const mixedBoundary = boundary();
    const parts = [`--${mixedBoundary}`, bodySection];
    for (const attachment of input.attachments) {
      parts.push(`--${mixedBoundary}`, attachmentPart(attachment));
    }
    parts.push(`--${mixedBoundary}--`);
    message = [...headers, `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`, "", ...parts].join("\r\n");
  } else {
    message = [...headers, bodySection].join("\r\n");
  }

  return Buffer.from(message, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
