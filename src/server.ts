import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "./config.js";
import { registerSendEmailTool } from "./tools/gmail/sendEmail.js";
import { registerCreateDraftTool } from "./tools/gmail/createDraft.js";
import { registerGetInfoTool } from "./tools/docs/getInfo.js";
import { registerAppendContentTool } from "./tools/docs/appendContent.js";

export function createServer(config: Config): McpServer {
  const server = new McpServer({
    name: "google-workspace-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "ping",
    {
      title: "Ping",
      description: "Health check tool. Returns 'pong'. Useful for verifying the server is reachable.",
      // A real ZodObject (not a raw shape) avoids an SDK quirk where an empty
      // *raw shape* is normalized through zod/v4-mini and loses `additionalProperties: false`.
      inputSchema: z.object({}),
      outputSchema: { message: z.string() },
      annotations: { title: "Ping", readOnlyHint: true, openWorldHint: false },
    },
    async () => ({
      content: [{ type: "text", text: "pong" }],
      structuredContent: { message: "pong" },
    }),
  );

  if (config.ENABLE_GMAIL_SEND) {
    registerSendEmailTool(server, config);
  }
  if (config.ENABLE_GMAIL_DRAFTS) {
    registerCreateDraftTool(server, config);
  }
  if (config.ENABLE_DOCS_APPEND) {
    registerGetInfoTool(server, config);
    registerAppendContentTool(server, config);
  }

  return server;
}
