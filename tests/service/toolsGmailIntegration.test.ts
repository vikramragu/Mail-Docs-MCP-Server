import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const messagesSend = vi.fn();
const draftsCreate = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        messages: { send: messagesSend },
        drafts: { create: draftsCreate },
      },
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

beforeEach(() => {
  messagesSend.mockReset();
  draftsCreate.mockReset();
});

describe("gmail_send_email (live path, mocked googleapis)", () => {
  it("sends and returns the Gmail message id", async () => {
    messagesSend.mockResolvedValue({ data: { id: "msg-1", threadId: "thread-1" } });
    const client = await connectedClient();

    const result = await client.callTool({
      name: "gmail_send_email",
      arguments: { to: ["a@example.com"], subject: "Hello", body: "Hi there" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      status: "sent",
      message_id: "msg-1",
      thread_id: "thread-1",
      to: ["a@example.com"],
    });
    expect(messagesSend).toHaveBeenCalledTimes(1);
  });

  it("sends an HTML email with attachment and surfaces a 403 as a tool error", async () => {
    const forbidden = new Error("forbidden") as Error & { response: { status: number } };
    forbidden.response = { status: 403 };
    messagesSend.mockRejectedValue(forbidden);
    const client = await connectedClient();

    const result = await client.callTool({
      name: "gmail_send_email",
      arguments: {
        to: ["a@example.com"],
        subject: "Hello",
        body: "<p>Hi</p>",
        body_format: "html",
        attachments: [{ filename: "x.txt", mime_type: "text/plain", content_base64: Buffer.from("hi").toString("base64") }],
      },
    });

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(/forbidden|permission denied/i);
  });

  it("rejects attachments over the configured size limit before calling Gmail", async () => {
    const client = await connectedClient({ MAX_ATTACHMENT_MB: 1 });
    const bigBase64 = Buffer.alloc(2 * 1024 * 1024).toString("base64");

    const result = await client.callTool({
      name: "gmail_send_email",
      arguments: {
        to: ["a@example.com"],
        subject: "Hello",
        body: "Hi",
        attachments: [{ filename: "big.bin", mime_type: "application/octet-stream", content_base64: bigBase64 }],
      },
    });

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(/Attachments exceed 1 MB/);
    expect(messagesSend).not.toHaveBeenCalled();
  });
});

describe("gmail_create_draft (live path, mocked googleapis)", () => {
  it("creates a draft and returns the draft id", async () => {
    draftsCreate.mockResolvedValue({ data: { id: "draft-1", message: { id: "msg-1" } } });
    const client = await connectedClient();

    const result = await client.callTool({
      name: "gmail_create_draft",
      arguments: { to: ["a@example.com"], subject: "Hello", body: "Hi there" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      status: "draft_created",
      draft_id: "draft-1",
      message_id: "msg-1",
      to: ["a@example.com"],
    });
  });
});
