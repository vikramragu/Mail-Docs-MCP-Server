import { describe, it, expect } from "vitest";
import {
  isValidEmail,
  assertNoHeaderInjection,
  assertRecipientsAllowed,
  assertRecipientCount,
  assertAttachmentsWithinLimit,
  assertDocumentAllowed,
  base64ByteLength,
} from "../../src/tools/validation.js";
import { ValidationError, RecipientDomainError, AttachmentTooLargeError, DocumentAllowlistError } from "../../src/errors.js";
import { makeTestConfig as baseConfig } from "../testConfig.js";

describe("isValidEmail", () => {
  it("accepts well-formed addresses", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("first.last+tag@sub.example.co")).toBe(true);
  });

  it("rejects malformed addresses", () => {
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("missing-domain@")).toBe(false);
    expect(isValidEmail("@missing-local.com")).toBe(false);
  });

  it("rejects CR/LF injection attempts", () => {
    expect(isValidEmail("user@example.com\r\nBcc: evil@example.com")).toBe(false);
  });
});

describe("assertNoHeaderInjection", () => {
  it("passes clean values", () => {
    expect(() => assertNoHeaderInjection("subject", "Hello world")).not.toThrow();
  });

  it("throws ValidationError on CR or LF", () => {
    expect(() => assertNoHeaderInjection("subject", "Hello\r\nBcc: evil@example.com")).toThrow(ValidationError);
  });
});

describe("assertRecipientsAllowed", () => {
  it("allows anything when no allowlist is configured", () => {
    expect(() => assertRecipientsAllowed(baseConfig(), ["anyone@anywhere.com"])).not.toThrow();
  });

  it("allows recipients within an allowlisted domain", () => {
    const config = baseConfig({ ALLOWED_RECIPIENT_DOMAINS: ["company.com"] });
    expect(() => assertRecipientsAllowed(config, ["a@company.com"])).not.toThrow();
  });

  it("rejects recipients outside the allowlist", () => {
    const config = baseConfig({ ALLOWED_RECIPIENT_DOMAINS: ["company.com"] });
    expect(() => assertRecipientsAllowed(config, ["a@other.com"])).toThrow(RecipientDomainError);
  });
});

describe("assertRecipientCount", () => {
  it("rejects when combined recipients exceed the configured maximum", () => {
    const config = baseConfig({ MAX_RECIPIENTS: 2 });
    expect(() => assertRecipientCount(config, ["a@x.com", "b@x.com", "c@x.com"])).toThrow(ValidationError);
  });
});

describe("base64ByteLength", () => {
  it("matches the real decoded byte length", () => {
    const content = Buffer.from("hello world");
    const base64 = content.toString("base64");
    expect(base64ByteLength(base64)).toBe(content.length);
  });
});

describe("assertAttachmentsWithinLimit", () => {
  it("rejects when combined attachment size exceeds MAX_ATTACHMENT_MB", () => {
    const config = baseConfig({ MAX_ATTACHMENT_MB: 1 });
    const bigBase64 = Buffer.alloc(2 * 1024 * 1024).toString("base64");
    expect(() => assertAttachmentsWithinLimit(config, [{ content_base64: bigBase64 }])).toThrow(AttachmentTooLargeError);
  });

  it("allows attachments under the limit", () => {
    const config = baseConfig({ MAX_ATTACHMENT_MB: 1 });
    const smallBase64 = Buffer.alloc(1024).toString("base64");
    expect(() => assertAttachmentsWithinLimit(config, [{ content_base64: smallBase64 }])).not.toThrow();
  });
});

describe("assertDocumentAllowed", () => {
  it("allows any document when no allowlist is configured", () => {
    expect(() => assertDocumentAllowed(baseConfig(), "doc123")).not.toThrow();
  });

  it("rejects documents outside the allowlist", () => {
    const config = baseConfig({ ALLOWED_DOCUMENT_IDS: ["doc123"] });
    expect(() => assertDocumentAllowed(config, "other")).toThrow(DocumentAllowlistError);
  });

  it("allows documents on the allowlist", () => {
    const config = baseConfig({ ALLOWED_DOCUMENT_IDS: ["doc123"] });
    expect(() => assertDocumentAllowed(config, "doc123")).not.toThrow();
  });
});
