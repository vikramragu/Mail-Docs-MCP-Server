import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { makeTestConfig } from "../testConfig.js";

async function connectedClient(config = makeTestConfig({ DRY_RUN: true })) {
  const server = createServer(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

describe("tools/call", () => {
  it("ping returns pong with structuredContent", async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({ name: "ping", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ message: "pong" });
  });

  it("gmail_send_email in DRY_RUN mode returns a preview without sending", async () => {
    const { client } = await connectedClient(makeTestConfig({ DRY_RUN: true }));
    const result = await client.callTool({
      name: "gmail_send_email",
      arguments: { to: ["a@example.com"], subject: "Hi", body: "Hello" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ status: "dry_run", to: ["a@example.com"] });
    expect((result.structuredContent as { preview: string }).preview).toContain("Subject:");
  });

  it("gmail_create_draft in DRY_RUN mode returns a preview without creating", async () => {
    const { client } = await connectedClient(makeTestConfig({ DRY_RUN: true }));
    const result = await client.callTool({
      name: "gmail_create_draft",
      arguments: { to: ["a@example.com"], subject: "Hi", body: "Hello" },
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ status: "dry_run", to: ["a@example.com"] });
  });

  it("rejects a recipient outside the configured allowlist with isError: true", async () => {
    const { client } = await connectedClient(makeTestConfig({ DRY_RUN: true, ALLOWED_RECIPIENT_DOMAINS: ["company.com"] }));
    const result = await client.callTool({
      name: "gmail_send_email",
      arguments: { to: ["a@other.com"], subject: "Hi", body: "Hello" },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(/Recipient domain not allowed/);
  });

  it("rejects a malformed document reference with isError: true", async () => {
    const { client } = await connectedClient(makeTestConfig({ DRY_RUN: true }));
    const result = await client.callTool({
      name: "docs_get_info",
      arguments: { document: "not a valid doc reference!!" },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(/Could not extract a document ID/);
  });

  it("returns isError: true (not a protocol crash) for malformed arguments", async () => {
    const { client } = await connectedClient();
    const result = await client.callTool({
      name: "gmail_send_email",
      arguments: { to: ["not-an-email"], subject: "Hi", body: "Hello" },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0].text).toMatch(/Invalid/i);
  });
});
