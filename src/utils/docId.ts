const DOC_URL_RE = /\/document\/d\/([a-zA-Z0-9_-]+)/;
const VALID_ID_RE = /^[a-zA-Z0-9_-]+$/;

export class InvalidDocumentReferenceError extends Error {
  constructor(input: string) {
    super(`Could not extract a document ID from "${input}". Provide a Google Docs URL or raw document ID.`);
  }
}

/** Accepts either a full Google Docs URL or a raw document ID and returns the ID. */
export function extractDocumentId(input: string): string {
  const trimmed = input.trim();
  const match = DOC_URL_RE.exec(trimmed);
  if (match?.[1]) return match[1];
  if (VALID_ID_RE.test(trimmed)) return trimmed;
  throw new InvalidDocumentReferenceError(input);
}

export function documentUrl(documentId: string): string {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}
