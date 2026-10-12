import { describe, it, expect, vi, beforeEach } from "vitest";
import type { docs_v1 } from "googleapis";

const documentsGet = vi.fn();
const documentsBatchUpdate = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    docs: vi.fn(() => ({
      documents: { get: documentsGet, batchUpdate: documentsBatchUpdate },
    })),
  },
}));

const { getDocument, summarizeDocument, findTab, segmentAnchorIndex, batchUpdateWithRetry } = await import(
  "../../src/services/docsService.js"
);

const fakeAuth = {} as never;

beforeEach(() => {
  documentsGet.mockReset();
  documentsBatchUpdate.mockReset();
});

describe("getDocument", () => {
  it("fetches the document with includeTabsContent", async () => {
    documentsGet.mockResolvedValue({ data: { documentId: "d1", title: "T" } });
    const doc = await getDocument(fakeAuth, "d1");
    expect(documentsGet).toHaveBeenCalledWith({ documentId: "d1", includeTabsContent: true });
    expect(doc.documentId).toBe("d1");
  });
});

describe("summarizeDocument", () => {
  it("flattens nested child tabs", () => {
    const doc: docs_v1.Schema$Document = {
      documentId: "d1",
      title: "Weekly Notes",
      tabs: [
        {
          tabProperties: { tabId: "t.0", title: "Tab 1" },
          childTabs: [{ tabProperties: { tabId: "t.0.1", title: "Nested" } }],
        },
        { tabProperties: { tabId: "t.1", title: "Tab 2" } },
      ],
    };
    const info = summarizeDocument(doc);
    expect(info).toEqual({
      documentId: "d1",
      title: "Weekly Notes",
      tabs: [
        { tabId: "t.0", title: "Tab 1" },
        { tabId: "t.0.1", title: "Nested" },
        { tabId: "t.1", title: "Tab 2" },
      ],
    });
  });
});

describe("findTab", () => {
  const doc: docs_v1.Schema$Document = {
    tabs: [
      { tabProperties: { tabId: "t.0", title: "First" } },
      {
        tabProperties: { tabId: "t.1", title: "Second" },
        childTabs: [{ tabProperties: { tabId: "t.1.1", title: "Child" } }],
      },
    ],
  };

  it("returns the first tab when no tabId is given", () => {
    expect(findTab(doc)?.tabProperties?.tabId).toBe("t.0");
  });

  it("finds a top-level tab by id", () => {
    expect(findTab(doc, "t.1")?.tabProperties?.title).toBe("Second");
  });

  it("finds a nested child tab by id", () => {
    expect(findTab(doc, "t.1.1")?.tabProperties?.title).toBe("Child");
  });

  it("returns undefined for an unknown tab id", () => {
    expect(findTab(doc, "nope")).toBeUndefined();
  });
});

describe("segmentAnchorIndex", () => {
  it("returns endIndex - 1 of the last content element", () => {
    const body: docs_v1.Schema$Body = { content: [{ endIndex: 1 }, { endIndex: 25 }] };
    expect(segmentAnchorIndex(body)).toBe(24);
  });

  it("falls back to 1 for an empty body", () => {
    expect(segmentAnchorIndex(undefined)).toBe(1);
    expect(segmentAnchorIndex({ content: [] })).toBe(1);
  });
});

describe("batchUpdateWithRetry", () => {
  it("applies the batchUpdate once on success", async () => {
    documentsBatchUpdate.mockResolvedValue({ data: { writeControl: { requiredRevisionId: "rev2" } } });
    const rebuild = vi.fn();

    const result = await batchUpdateWithRetry(fakeAuth, "doc1", "rev1", [{ insertText: { text: "x" } }], rebuild);

    expect(documentsBatchUpdate).toHaveBeenCalledTimes(1);
    expect(documentsBatchUpdate).toHaveBeenCalledWith({
      documentId: "doc1",
      requestBody: {
        requests: [{ insertText: { text: "x" } }],
        writeControl: { requiredRevisionId: "rev1" },
      },
    });
    expect(rebuild).not.toHaveBeenCalled();
    expect(result).toEqual({ revisionId: "rev2" });
  });

  it("re-fetches and retries once on a revision conflict", async () => {
    const conflictError = new Error("Required revision mismatch: the document has changed");
    documentsBatchUpdate.mockRejectedValueOnce(conflictError).mockResolvedValueOnce({
      data: { writeControl: { requiredRevisionId: "rev3" } },
    });
    const rebuild = vi.fn().mockResolvedValue({
      requests: [{ insertText: { text: "y" } }],
      requiredRevisionId: "rev2",
    });

    const result = await batchUpdateWithRetry(fakeAuth, "doc1", "rev1", [{ insertText: { text: "x" } }], rebuild);

    expect(documentsBatchUpdate).toHaveBeenCalledTimes(2);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(documentsBatchUpdate).toHaveBeenNthCalledWith(2, {
      documentId: "doc1",
      requestBody: {
        requests: [{ insertText: { text: "y" } }],
        writeControl: { requiredRevisionId: "rev2" },
      },
    });
    expect(result).toEqual({ revisionId: "rev3" });
  });

  it("propagates non-conflict errors without retrying", async () => {
    const notFound = new Error("not found") as Error & { response: { status: number } };
    notFound.response = { status: 404 };
    documentsBatchUpdate.mockRejectedValue(notFound);
    const rebuild = vi.fn();

    await expect(batchUpdateWithRetry(fakeAuth, "doc1", "rev1", [], rebuild)).rejects.toThrow();
    expect(rebuild).not.toHaveBeenCalled();
  });
});
