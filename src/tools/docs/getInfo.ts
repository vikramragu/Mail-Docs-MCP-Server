import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../config.js";
import { getAuthorizedClient } from "../../auth/googleAuth.js";
import { getDocument, summarizeDocument } from "../../services/docsService.js";
import { extractDocumentId, documentUrl } from "../../utils/docId.js";
import { assertDocumentAllowed } from "../validation.js";
import { runTool, textResult } from "../toolResult.js";

const outputShape = {
  document_id: z.string(),
  title: z.string(),
  url: z.string(),
  tabs: z.array(
    z.object({
      tab_id: z.string(),
      title: z.string(),
    }),
  ),
};

export function registerGetInfoTool(server: McpServer, config: Config): void {
  server.registerTool(
    "docs_get_info",
    {
      title: "Get Google Doc info",
      description:
        "Get the title, tabs, and current end position of an existing Google Doc. Read-only — makes no changes. " +
        "Use before appending if you need to confirm the right document or tab.",
      inputSchema: {
        document: z.string().min(1).describe("Full Google Docs URL or raw document ID."),
      },
      outputSchema: outputShape,
      annotations: {
        title: "Get Google Doc info",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      const { document } = args as { document: string };
      const documentId = extractDocumentId(document);
      return runTool("docs_get_info", { documentId }, async () => {
        assertDocumentAllowed(config, documentId);
        const auth = getAuthorizedClient(config);
        const doc = await getDocument(auth, documentId);
        const info = summarizeDocument(doc);

        return textResult(`"${info.title}" (${info.tabs.length} tab${info.tabs.length === 1 ? "" : "s"})`, {
          document_id: info.documentId,
          title: info.title,
          url: documentUrl(info.documentId),
          tabs: info.tabs.map((t) => ({ tab_id: t.tabId, title: t.title })),
        });
      });
    },
  );
}
