import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../config.js";
import { getAuthorizedClient } from "../../auth/googleAuth.js";
import { createDraft } from "../../services/gmailService.js";
import { runTool, textResult } from "../toolResult.js";
import { gmailInputShape, composeMessage, decodeRawPreview, type GmailToolInput } from "./shared.js";

const outputShape = {
  status: z.enum(["draft_created", "dry_run"]),
  draft_id: z.string().optional(),
  message_id: z.string().optional(),
  to: z.array(z.string()),
  preview: z.string().optional().describe("Decoded MIME preview. Present only when DRY_RUN is enabled."),
};

export function registerCreateDraftTool(server: McpServer, config: Config): void {
  server.registerTool(
    "gmail_create_draft",
    {
      title: "Create Gmail draft",
      description:
        "Create a draft email in the authenticated Gmail account without sending it. Use this when the user wants " +
        "to review a message before sending, or explicitly asks for a draft. Supports plain text or HTML body, CC, " +
        "BCC, and reply-to. Returns the Gmail draft ID.",
      inputSchema: gmailInputShape(config),
      outputSchema: outputShape,
      annotations: {
        title: "Create Gmail draft",
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const input = args as GmailToolInput;
      return runTool("gmail_create_draft", { recipientCount: input.to.length + (input.cc?.length ?? 0) + (input.bcc?.length ?? 0) }, async () => {
        const { raw } = composeMessage(config, input);

        if (config.DRY_RUN) {
          return textResult(`DRY_RUN: would create a draft to ${input.to.join(", ")} (not created).`, {
            status: "dry_run",
            to: input.to,
            preview: decodeRawPreview(raw),
          });
        }

        const auth = getAuthorizedClient(config);
        const result = await createDraft(auth, { raw, threadId: input.thread_id });

        return textResult(`Draft created for ${input.to.join(", ")}. Draft ID: ${result.draftId}`, {
          status: "draft_created",
          draft_id: result.draftId,
          message_id: result.messageId,
          to: input.to,
        });
      });
    },
  );
}
