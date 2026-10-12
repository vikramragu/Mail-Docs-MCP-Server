import { z } from "zod";
import type { Config } from "../../config.js";
import { buildMimeMessage } from "../../utils/mime.js";
import {
  emailField,
  assertNoHeaderInjection,
  assertRecipientsAllowed,
  assertRecipientCount,
  assertAttachmentsWithinLimit,
} from "../validation.js";

export function gmailInputShape(config: Config) {
  return {
    to: z.array(emailField()).min(1).max(config.MAX_RECIPIENTS).describe("Recipient email addresses (1-50)."),
    subject: z.string().min(1).max(998).describe("Email subject line. No line breaks."),
    body: z.string().min(1).max(200000).describe("Message body. Plain text or HTML depending on body_format."),
    body_format: z
      .enum(["text", "html"])
      .optional()
      .default("text")
      .describe('Body content type: "text" (default) or "html" (a plain-text fallback is generated automatically).'),
    cc: z.array(emailField()).max(config.MAX_RECIPIENTS).optional().describe("CC recipient email addresses."),
    bcc: z.array(emailField()).max(config.MAX_RECIPIENTS).optional().describe("BCC recipient email addresses."),
    reply_to: emailField().optional().describe("Reply-To email address."),
    attachments: z
      .array(
        z.object({
          filename: z.string().min(1).max(255),
          mime_type: z.string().min(1).max(255),
          content_base64: z.string().min(1).describe("Base64-encoded file contents."),
        }),
      )
      .max(10)
      .optional()
      .describe(`File attachments. Combined size must stay under ${config.MAX_ATTACHMENT_MB} MB.`),
    thread_id: z.string().optional().describe("Gmail thread ID to reply within an existing thread."),
  };
}

export type GmailToolInput = {
  to: string[];
  subject: string;
  body: string;
  body_format: "text" | "html";
  cc?: string[];
  bcc?: string[];
  reply_to?: string;
  attachments?: { filename: string; mime_type: string; content_base64: string }[];
  thread_id?: string;
};

export interface ComposedMessage {
  raw: string;
  allRecipients: string[];
}

/** Shared validation + MIME composition used by both gmail_send_email and gmail_create_draft. */
export function composeMessage(config: Config, input: GmailToolInput): ComposedMessage {
  assertNoHeaderInjection("subject", input.subject);

  const allRecipients = [...input.to, ...(input.cc ?? []), ...(input.bcc ?? [])];
  assertRecipientCount(config, allRecipients);
  assertRecipientsAllowed(config, allRecipients);

  if (input.attachments?.length) {
    assertAttachmentsWithinLimit(config, input.attachments);
  }

  const raw = buildMimeMessage({
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    subject: input.subject,
    body: input.body,
    bodyFormat: input.body_format,
    replyTo: input.reply_to,
    attachments: input.attachments?.map((a) => ({
      filename: a.filename,
      mimeType: a.mime_type,
      contentBase64: a.content_base64,
    })),
  });

  return { raw, allRecipients };
}

export function decodeRawPreview(raw: string): string {
  const base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}
