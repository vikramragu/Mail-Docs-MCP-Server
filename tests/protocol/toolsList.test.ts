import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { makeTestConfig } from "../testConfig.js";

const DISALLOWED_KEYWORDS = ["oneOf", "anyOf", "allOf", "$ref", "patternProperties", "format"];
const TOOL_NAME_RE = /^[a-zA-Z0-9_-]+$/;

async function connectedClient(config = makeTestConfig()) {
  const server = createServer(config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

/** Recursively walks a JSON Schema object looking for keywords disallowed by problemStatement.md §7. */
function findDisallowedKeywords(schema: unknown, path = "$"): string[] {
  const violations: string[] = [];
  if (schema === null || typeof schema !== "object") return violations;

  if (Array.isArray(schema)) {
    schema.forEach((item, i) => violations.push(...findDisallowedKeywords(item, `${path}[${i}]`)));
    return violations;
  }

  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (DISALLOWED_KEYWORDS.includes(key)) {
      violations.push(`${path}.${key}`);
    }
    violations.push(...findDisallowedKeywords(value, `${path}.${key}`));
  }
  return violations;
}

function maxNestingDepth(schema: unknown, depth = 0): number {
  if (schema === null || typeof schema !== "object") return depth;
  if (Array.isArray(schema)) {
    return Math.max(depth, ...schema.map((s) => maxNestingDepth(s, depth)));
  }
  const obj = schema as Record<string, unknown>;
  let childDepth = depth;
  if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
    for (const prop of Object.values(obj.properties as Record<string, unknown>)) {
      childDepth = Math.max(childDepth, maxNestingDepth(prop, depth + 1));
    }
  }
  if (obj.type === "array" && obj.items) {
    childDepth = Math.max(childDepth, maxNestingDepth(obj.items, depth));
  }
  return childDepth;
}

describe("tools/list — cross-agent schema portability (§7)", () => {
  it("returns all tools enabled by default config with portable schemas", async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();

    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["docs_append_content", "docs_get_info", "gmail_create_draft", "gmail_send_email", "ping"]);

    for (const tool of tools) {
      expect(tool.name.length).toBeLessThanOrEqual(64);
      expect(tool.name).toMatch(TOOL_NAME_RE);
      expect(tool.description, `${tool.name} must have a description`).toBeTruthy();

      if (tool.inputSchema) {
        expect(findDisallowedKeywords(tool.inputSchema), `${tool.name} inputSchema`).toEqual([]);
        if ((tool.inputSchema as { type?: string }).type === "object") {
          expect((tool.inputSchema as { additionalProperties?: boolean }).additionalProperties).toBe(false);
        }
      }
      if (tool.outputSchema) {
        expect(findDisallowedKeywords(tool.outputSchema), `${tool.name} outputSchema`).toEqual([]);
      }
    }
  });

  it("keeps schema nesting at or below 2 levels", async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      if (tool.inputSchema) {
        expect(maxNestingDepth(tool.inputSchema), `${tool.name} inputSchema nesting`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("omits disabled-feature tools from tools/list", async () => {
    const { client } = await connectedClient(
      makeTestConfig({ ENABLE_GMAIL_DRAFTS: false, ENABLE_DOCS_APPEND: false }),
    );
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["gmail_send_email", "ping"]);
  });

  it("marks gmail_send_email with write/side-effect annotations", async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    const sendEmail = tools.find((t) => t.name === "gmail_send_email");
    expect(sendEmail?.annotations?.readOnlyHint).toBe(false);
    expect(sendEmail?.description).toMatch(/external side effects/i);
  });

  it("marks docs_get_info as read-only", async () => {
    const { client } = await connectedClient();
    const { tools } = await client.listTools();
    const getInfo = tools.find((t) => t.name === "docs_get_info");
    expect(getInfo?.annotations?.readOnlyHint).toBe(true);
  });
});
