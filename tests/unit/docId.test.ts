import { describe, it, expect } from "vitest";
import { extractDocumentId, documentUrl, InvalidDocumentReferenceError } from "../../src/utils/docId.js";

describe("extractDocumentId", () => {
  it("extracts the ID from a full Google Docs URL", () => {
    expect(extractDocumentId("https://docs.google.com/document/d/1AbC-_123/edit")).toBe("1AbC-_123");
  });

  it("extracts the ID from a URL with extra path segments and query params", () => {
    expect(extractDocumentId("https://docs.google.com/document/d/1AbC-_123/edit?tab=t.0#heading=h.abc")).toBe("1AbC-_123");
  });

  it("accepts a raw document ID", () => {
    expect(extractDocumentId("1AbC-_123")).toBe("1AbC-_123");
  });

  it("trims whitespace", () => {
    expect(extractDocumentId("  1AbC-_123  ")).toBe("1AbC-_123");
  });

  it("throws for unparseable input", () => {
    expect(() => extractDocumentId("not a valid doc reference!")).toThrow(InvalidDocumentReferenceError);
  });
});

describe("documentUrl", () => {
  it("builds the canonical edit URL", () => {
    expect(documentUrl("1AbC")).toBe("https://docs.google.com/document/d/1AbC/edit");
  });
});
