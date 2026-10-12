import { google } from "googleapis";
import type { docs_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { withGoogleRetry } from "../errors.js";

export interface TabSummary {
  tabId: string;
  title: string;
}

export interface DocumentInfo {
  documentId: string;
  title: string;
  tabs: TabSummary[];
}

function docsClient(auth: OAuth2Client): docs_v1.Docs {
  return google.docs({ version: "v1", auth });
}

export async function getDocument(auth: OAuth2Client, documentId: string): Promise<docs_v1.Schema$Document> {
  const docs = docsClient(auth);
  const response = await withGoogleRetry(
    () =>
      docs.documents.get({
        documentId,
        includeTabsContent: true,
      }),
    3,
    "documents",
  );
  return response.data;
}

function flattenTabs(tabs: docs_v1.Schema$Tab[] | undefined): TabSummary[] {
  const result: TabSummary[] = [];
  for (const tab of tabs ?? []) {
    const id = tab.tabProperties?.tabId;
    const title = tab.tabProperties?.title;
    if (id) result.push({ tabId: id, title: title ?? "" });
    if (tab.childTabs?.length) result.push(...flattenTabs(tab.childTabs));
  }
  return result;
}

export function summarizeDocument(doc: docs_v1.Schema$Document): DocumentInfo {
  return {
    documentId: doc.documentId ?? "",
    title: doc.title ?? "",
    tabs: flattenTabs(doc.tabs ?? undefined),
  };
}

/** Finds the requested tab (searching nested child tabs too), or the first top-level tab if none given. */
export function findTab(doc: docs_v1.Schema$Document, tabId?: string): docs_v1.Schema$Tab | undefined {
  const tabs = doc.tabs ?? [];
  if (!tabId) return tabs[0];

  function search(candidates: docs_v1.Schema$Tab[]): docs_v1.Schema$Tab | undefined {
    for (const tab of candidates) {
      if (tab.tabProperties?.tabId === tabId) return tab;
      const nested = tab.childTabs ? search(tab.childTabs) : undefined;
      if (nested) return nested;
    }
    return undefined;
  }
  return search(tabs);
}

/** Index just before the segment's trailing newline — the correct append point. */
export function segmentAnchorIndex(body: docs_v1.Schema$Body | undefined | null): number {
  const content = body?.content ?? [];
  if (content.length === 0) return 1;
  const last = content[content.length - 1];
  const endIndex = last?.endIndex ?? 1;
  return Math.max(1, endIndex - 1);
}

export interface BatchUpdateResult {
  revisionId: string;
}

function isRevisionConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /revision/i.test(message) && /mismatch|required|precondition/i.test(message);
}

/**
 * Runs `batchUpdate` with optimistic concurrency via `writeControl`. If the
 * document changed since `requiredRevisionId` was captured, re-fetches once
 * via `rebuild` and retries a single time before giving up.
 */
export async function batchUpdateWithRetry(
  auth: OAuth2Client,
  documentId: string,
  requiredRevisionId: string,
  requests: docs_v1.Schema$Request[],
  rebuild: () => Promise<{ requests: docs_v1.Schema$Request[]; requiredRevisionId: string }>,
): Promise<BatchUpdateResult> {
  const docs = docsClient(auth);
  try {
    const response = await withGoogleRetry(
      () =>
        docs.documents.batchUpdate({
          documentId,
          requestBody: {
            requests,
            writeControl: { requiredRevisionId },
          },
        }),
      3,
      "documents",
    );
    return { revisionId: response.data.writeControl?.requiredRevisionId ?? requiredRevisionId };
  } catch (err) {
    if (!isRevisionConflict(err)) throw err;
    const rebuilt = await rebuild();
    const response = await withGoogleRetry(
      () =>
        docs.documents.batchUpdate({
          documentId,
          requestBody: {
            requests: rebuilt.requests,
            writeControl: { requiredRevisionId: rebuilt.requiredRevisionId },
          },
        }),
      3,
      "documents",
    );
    return { revisionId: response.data.writeControl?.requiredRevisionId ?? rebuilt.requiredRevisionId };
  }
}
