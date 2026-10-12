import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const documentsGet = vi.fn();
const documentsBatchUpdate = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    docs: vi.fn(() => ({
      documents: { get: documentsGet, batchUpdate: documentsBatchUpdate },
    })),
  },
}));

vi.mock("../../src/auth/googleAuth.js", () => ({
  getAuthorizedClient: vi.fn(() => ({})),
}));

const { createServer } = await import("../../src/server.js");
const { makeTestConfig } = await import("../testConfig.js");

async function connectedClient(configOverrides = {}) {
  const server = createServer(makeTestConfig({ DRY_RUN: false, ...configOverrides }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function fakeDoc(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "doc123",
    title: "Weekly Notes",
    revisionId: "rev1",
    tabs: [
      {
        tabProperties: { tabId: "t.0", title: "Tab 1" },
        documentTab: { body: { content: [{ endIndex: 1 }, { endIndex: 50 }] } },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  documentsGet.mockReset();
  documentsBatchUpdate.mockReset();
});

describe("docs_get_info", () => {
  it("returns title, url, and tabs", async () => {
    documentsGet.mockResolvedValue({ data: fakeDoc() });
    const client = await connectedClient();

    const result = await client.callTool({ name: "docs_get_info", arguments: { document: "doc123" } });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      document_id: "doc123",
      title: "Weekly Notes",
      url: "https://docs.google.com/document/d/doc123/edit",
      tabs: [{ tab_id: "t.0", title: "Tab 1" }],
    });
  });

  it("accepts a full Google Docs URL and extracts the ID", async () => {
    documentsGet.mockResolvedValue({ data: fakeDoc() });
    const client = await connectedClient();

    await client.callTool({ name: "docs_get_info", arguments: { document: "https://docs.google.com/document/d/doc123/edit" } });

    expect(documentsGet).toHaveBeenCalledWith({ documentId: "doc123", includeTabsContent: true });
  });

  it("maps a 404 to the Docs-specific not-found message", async () => {
    const notFound = new Error("not found") as Error & { response: { status: number } };
    notFound.response = { status: 404 };
    documentsGet.mockRejectedValue(notFound);
    const client = await connectedClient();

    const result = await client.callTool({ name: "docs_get_info", arguments: { document: "doc123" } });

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(/not found or not shared/i);
  });

  it("enforces the document allowlist before calling Google", async () => {
    const client = await connectedClient({ ALLOWED_DOCUMENT_IDS: ["other-doc"] });

    const result = await client.callTool({ name: "docs_get_info", arguments: { document: "doc123" } });

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(/not on the configured allowlist/i);
    expect(documentsGet).not.toHaveBeenCalled();
  });
});

describe("docs_append_content", () => {
  it("appends blocks and returns the summary", async () => {
    documentsGet.mockResolvedValue({ data: fakeDoc() });
    documentsBatchUpdate.mockResolvedValue({ data: { writeControl: { requiredRevisionId: "rev2" } } });
    const client = await connectedClient();

    const result = await client.callTool({
      name: "docs_append_content",
      arguments: {
        document: "doc123",
        blocks: [
          { type: "heading1", text: "Title" },
          { type: "bullet", text: "Point one" },
        ],
      },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      status: "appended",
      document_id: "doc123",
      tab_id: "t.0",
      blocks_appended: 2,
      url: "https://docs.google.com/document/d/doc123/edit",
    });
    expect(documentsBatchUpdate).toHaveBeenCalledTimes(1);
    const callArgs = documentsBatchUpdate.mock.calls[0][0];
    expect(callArgs.requestBody.writeControl).toEqual({ requiredRevisionId: "rev1" });
    expect(callArgs.requestBody.requests[0].insertText.location.index).toBe(49); // endIndex 50 - 1
  });

  it("DRY_RUN returns planned requests without calling batchUpdate", async () => {
    documentsGet.mockResolvedValue({ data: fakeDoc() });
    const client = await connectedClient({ DRY_RUN: true });

    const result = await client.callTool({
      name: "docs_append_content",
      arguments: { document: "doc123", blocks: [{ type: "paragraph", text: "Hello" }] },
    });

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { status: string }).status).toBe("dry_run");
    expect(documentsBatchUpdate).not.toHaveBeenCalled();
  });

  it("re-fetches and retries once on a revision conflict", async () => {
    documentsGet.mockResolvedValue({ data: fakeDoc() });
    const conflictError = new Error("Required revision mismatch: the document has changed");
    documentsBatchUpdate.mockRejectedValueOnce(conflictError).mockResolvedValueOnce({
      data: { writeControl: { requiredRevisionId: "rev3" } },
    });
    const client = await connectedClient();

    const result = await client.callTool({
      name: "docs_append_content",
      arguments: { document: "doc123", blocks: [{ type: "paragraph", text: "Hello" }] },
    });

    expect(result.isError).toBeFalsy();
    expect(documentsGet).toHaveBeenCalledTimes(2); // initial fetch + rebuild on conflict
    expect(documentsBatchUpdate).toHaveBeenCalledTimes(2);
  });

  it("rejects an unknown tab_id", async () => {
    documentsGet.mockResolvedValue({ data: fakeDoc() });
    const client = await connectedClient();

    const result = await client.callTool({
      name: "docs_append_content",
      arguments: { document: "doc123", tab_id: "nope", blocks: [{ type: "paragraph", text: "Hello" }] },
    });

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(/Tab not found/);
    expect(documentsBatchUpdate).not.toHaveBeenCalled();
  });
});
