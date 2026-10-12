import { describe, it, expect } from "vitest";
import { buildMimeMessage, encodeHeaderValue, htmlToText, HeaderInjectionError } from "../../src/utils/mime.js";

function decode(raw: string): string {
  const base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf-8");
}

describe("encodeHeaderValue", () => {
  it("leaves pure ASCII untouched", () => {
    expect(encodeHeaderValue("Hello world")).toBe("Hello world");
  });

  it("RFC 2047 base64-encodes non-ASCII subjects", () => {
    const encoded = encodeHeaderValue("Héllo wörld");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.*\?=$/);
    const base64 = encoded.slice("=?UTF-8?B?".length, -"?=".length);
    expect(Buffer.from(base64, "base64").toString("utf-8")).toBe("Héllo wörld");
  });

  it("rejects CR/LF", () => {
    expect(() => encodeHeaderValue("line1\r\nline2")).toThrow(HeaderInjectionError);
  });
});

describe("htmlToText", () => {
  it("strips tags and converts breaks/paragraphs", () => {
    const text = htmlToText("<p>Hello <b>World</b></p><p>Second</p>");
    expect(text).toBe("Hello World\n\nSecond");
  });

  it("decodes common entities", () => {
    expect(htmlToText("A &amp; B &lt;tag&gt;")).toBe("A & B <tag>");
  });
});

describe("buildMimeMessage", () => {
  it("builds a plain text message", () => {
    const raw = buildMimeMessage({
      to: ["a@example.com"],
      subject: "Hello",
      body: "Plain body",
      bodyFormat: "text",
    });
    const decoded = decode(raw);
    expect(decoded).toContain("To: a@example.com");
    expect(decoded).toContain("Subject: Hello");
    expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decoded).not.toContain("multipart");
  });

  it("builds an HTML message with a generated text fallback", () => {
    const raw = buildMimeMessage({
      to: ["a@example.com"],
      subject: "Hi",
      body: "<p>Hello <b>World</b></p>",
      bodyFormat: "html",
    });
    const decoded = decode(raw);
    expect(decoded).toContain("multipart/alternative");
    expect(decoded).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(decoded).toContain("Content-Type: text/html; charset=UTF-8");
  });

  it("encodes a UTF-8 subject per RFC 2047", () => {
    const raw = buildMimeMessage({
      to: ["a@example.com"],
      subject: "Café meeting ☕",
      body: "body",
      bodyFormat: "text",
    });
    const decoded = decode(raw);
    expect(decoded).toMatch(/Subject: =\?UTF-8\?B\?/);
  });

  it("wraps body + attachments in multipart/mixed", () => {
    const raw = buildMimeMessage({
      to: ["a@example.com"],
      subject: "With attachment",
      body: "See attached",
      bodyFormat: "text",
      attachments: [{ filename: "a.txt", mimeType: "text/plain", contentBase64: Buffer.from("hi").toString("base64") }],
    });
    const decoded = decode(raw);
    expect(decoded).toContain("multipart/mixed");
    expect(decoded).toContain('filename="a.txt"');
    expect(decoded).toContain("Content-Disposition: attachment");
  });

  it("includes Cc, Bcc, and Reply-To headers when provided", () => {
    const raw = buildMimeMessage({
      to: ["a@example.com"],
      cc: ["c@example.com"],
      bcc: ["b@example.com"],
      replyTo: "r@example.com",
      subject: "Headers",
      body: "body",
      bodyFormat: "text",
    });
    const decoded = decode(raw);
    expect(decoded).toContain("Cc: c@example.com");
    expect(decoded).toContain("Bcc: b@example.com");
    expect(decoded).toContain("Reply-To: r@example.com");
  });

  it("rejects header injection via CRLF in a recipient", () => {
    expect(() =>
      buildMimeMessage({
        to: ["a@example.com\r\nBcc: evil@example.com"],
        subject: "Hello",
        body: "body",
        bodyFormat: "text",
      }),
    ).toThrow(HeaderInjectionError);
  });

  it("base64url-encodes the output (no +, /, or = padding)", () => {
    const raw = buildMimeMessage({
      to: ["a@example.com"],
      subject: "Hello",
      body: "body",
      bodyFormat: "text",
    });
    expect(raw).not.toMatch(/[+/=]/);
  });
});
