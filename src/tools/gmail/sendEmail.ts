import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Config } from "../../config.js";
import { getAuthorizedClient } from "../../auth/googleAuth.js";
import { sendEmail } from "../../services/gmailService.js";
import { runTool, textResult } from "../toolResult.js";
import { gmailInputShape, composeMessage, decodeRawPreview, type GmailToolInput } from "./shared.js";

const outputShape = {
  status: z.enum(["sent", "dry_run"]),
  message_id: z.string().optional(),
  thread_id: z.string().optional(),
  to: z.array(z.string()),
  preview: z.string().optional().describe("Decoded MIME preview. Present only when DRY_RUN is enabled."),
};

export function registerSendEmailTool(server: McpServer, config: Config): void {
  server.registerTool(
    "gmail_send_email",
    {
      title: "Send Gmail email",
      description:
        "Send an email from the authenticated Gmail account. This is an ACTION WITH EXTERNAL SIDE EFFECTS — " +
        "it delivers a real email immediately. Use only when the user has clearly and explicitly asked to send " +
        "(not merely drafted or discussed) a message. Supports plain text or HTML body, CC, BCC, and reply-to. " +
        "Returns the Gmail message ID.",
      inputSchema: gmailInputShape(config),
      outputSchema: outputShape,
      annotations: {
        title: "Send Gmail email",
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const input = args as GmailToolInput;
      return runTool("gmail_send_email", { recipientCount: input.to.length + (input.cc?.length ?? 0) + (input.bcc?.length ?? 0) }, async () => {
        const { raw } = composeMessage(config, input);

        if (config.DRY_RUN) {
          return textResult(`DRY_RUN: would send email to ${input.to.join(", ")} (not sent).`, {
            status: "dry_run",
            to: input.to,
            preview: decodeRawPreview(raw),
          });
        }

        const auth = getAuthorizedClient(config);
        const result = await sendEmail(auth, { raw, threadId: input.thread_id });

        return textResult(`Email sent to ${input.to.join(", ")}. Message ID: ${result.messageId}`, {
          status: "sent",
          message_id: result.messageId,
          thread_id: result.threadId,
          to: input.to,
        });
      });
    },
  );
}
