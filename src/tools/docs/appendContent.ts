import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { docs_v1 } from "googleapis";
import type { Config } from "../../config.js";
import { getAuthorizedClient } from "../../auth/googleAuth.js";
import { getDocument, findTab, segmentAnchorIndex, batchUpdateWithRetry } from "../../services/docsService.js";
import { extractDocumentId, documentUrl } from "../../utils/docId.js";
import { buildAppendRequests, type ContentBlock } from "../../utils/docsRequestBuilder.js";
import { assertDocumentAllowed } from "../validation.js";
import { ValidationError } from "../../errors.js";
import { runTool, textResult } from "../toolResult.js";

const BLOCK_TYPES = ["paragraph", "heading1", "heading2", "heading3", "bullet", "numbered"] as const;

const blockSchema = z.object({
  type: z.enum(BLOCK_TYPES).describe("Block style."),
  text: z.string().min(1).max(10000).describe("Block text content."),
  bold: z.boolean().optional().default(false),
});

const inputShape = {
  document: z.string().min(1).describe("Full Google Docs URL or raw document ID."),
  blocks: z.array(blockSchema).min(1).max(200).describe("Ordered content blocks to append (1-200)."),
  tab_id: z.string().optional().describe("Target tab ID. Defaults to the document's first tab."),
  add_separator: z.boolean().optional().default(true).describe("Insert a blank line before the new content."),
};

const outputShape = {
  status: z.enum(["appended", "dry_run"]),
  document_id: z.string(),
  tab_id: z.string().optional(),
  blocks_appended: z.number().int(),
  characters_inserted: z.number().int(),
  url: z.string(),
};

type AppendInput = {
  document: string;
  blocks: { type: (typeof BLOCK_TYPES)[number]; text: string; bold: boolean }[];
  tab_id?: string;
  add_separator: boolean;
};

interface ResolvedTarget {
  body: docs_v1.Schema$Body | undefined;
  resolvedTabId: string | undefined;
}

function resolveTarget(doc: docs_v1.Schema$Document, tabId: string | undefined): ResolvedTarget {
  if (doc.tabs && doc.tabs.length > 0) {
    const tab = findTab(doc, tabId);
    if (!tab) {
      throw new ValidationError(`Tab not found: ${tabId}`);
    }
    return { body: tab.documentTab?.body ?? undefined, resolvedTabId: tab.tabProperties?.tabId ?? tabId };
  }
  return { body: doc.body ?? undefined, resolvedTabId: undefined };
}

export function registerAppendContentTool(server: McpServer, config: Config): void {
  server.registerTool(
    "docs_append_content",
    {
      title: "Append content to Google Doc",
      description:
        "Append content to the end of an existing Google Doc (optionally a specific tab). Does not modify existing " +
        "content. Supports paragraphs, headings, and bullet/numbered lists.",
      inputSchema: inputShape,
      outputSchema: outputShape,
      annotations: {
        title: "Append content to Google Doc",
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const input = args as AppendInput;
      const documentId = extractDocumentId(input.document);
      return runTool("docs_append_content", { documentId }, async () => {
        assertDocumentAllowed(config, documentId);
        const auth = getAuthorizedClient(config);

        const blocks: ContentBlock[] = input.blocks.map((b) => ({ type: b.type, text: b.text, bold: b.bold }));

        const doc = await getDocument(auth, documentId);
        const { body, resolvedTabId } = resolveTarget(doc, input.tab_id);
        const anchorIndex = segmentAnchorIndex(body);
        const { requests, charactersInserted } = buildAppendRequests({
          blocks,
          anchorIndex,
          addSeparator: input.add_separator,
          tabId: resolvedTabId,
        });

        if (config.DRY_RUN) {
          return textResult(`DRY_RUN: would append ${blocks.length} block(s) to document ${documentId} (not applied).`, {
            status: "dry_run",
            document_id: documentId,
            tab_id: resolvedTabId,
            blocks_appended: blocks.length,
            characters_inserted: charactersInserted,
            url: documentUrl(documentId),
            planned_requests: requests,
          });
        }

        await batchUpdateWithRetry(auth, documentId, doc.revisionId ?? "", requests, async () => {
          const freshDoc = await getDocument(auth, documentId);
          const { body: freshBody, resolvedTabId: freshTabId } = resolveTarget(freshDoc, input.tab_id);
          const rebuilt = buildAppendRequests({
            blocks,
            anchorIndex: segmentAnchorIndex(freshBody),
            addSeparator: input.add_separator,
            tabId: freshTabId,
          });
          return { requests: rebuilt.requests, requiredRevisionId: freshDoc.revisionId ?? "" };
        });

        return textResult(`Appended ${blocks.length} block(s) to document ${documentId}.`, {
          status: "appended",
          document_id: documentId,
          tab_id: resolvedTabId,
          blocks_appended: blocks.length,
          characters_inserted: charactersInserted,
          url: documentUrl(documentId),
        });
      });
    },
  );
}
