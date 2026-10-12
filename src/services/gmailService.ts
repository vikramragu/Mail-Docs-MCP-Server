import { google } from "googleapis";
import type { gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { withGoogleRetry } from "../errors.js";

export interface SendEmailParams {
  raw: string;
  threadId?: string;
}

export interface SendEmailResult {
  messageId: string;
  threadId?: string;
}

export interface CreateDraftResult {
  draftId: string;
  messageId?: string;
}

function gmailClient(auth: OAuth2Client): gmail_v1.Gmail {
  return google.gmail({ version: "v1", auth });
}

export async function sendEmail(auth: OAuth2Client, params: SendEmailParams): Promise<SendEmailResult> {
  const gmail = gmailClient(auth);
  const response = await withGoogleRetry(() =>
    gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: params.raw,
        threadId: params.threadId,
      },
    }),
  );
  const { id, threadId } = response.data;
  if (!id) throw new Error("Gmail API returned no message id");
  return { messageId: id, threadId: threadId ?? undefined };
}

export async function createDraft(auth: OAuth2Client, params: SendEmailParams): Promise<CreateDraftResult> {
  const gmail = gmailClient(auth);
  const response = await withGoogleRetry(() =>
    gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: {
          raw: params.raw,
          threadId: params.threadId,
        },
      },
    }),
  );
  const { id, message } = response.data;
  if (!id) throw new Error("Gmail API returned no draft id");
  return { draftId: id, messageId: message?.id ?? undefined };
}
