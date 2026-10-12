import { OAuth2Client } from "google-auth-library";
import type { Config } from "../config.js";
import { logger } from "../logger.js";
import { AuthRequiredError } from "../errors.js";
import { loadTokens, saveTokens } from "./tokenStore.js";

export const SCOPES = {
  gmailSend: "https://www.googleapis.com/auth/gmail.send",
  gmailCompose: "https://www.googleapis.com/auth/gmail.compose",
  documents: "https://www.googleapis.com/auth/documents",
} as const;

export function scopesForConfig(config: Config): string[] {
  const scopes: string[] = [];
  if (config.ENABLE_GMAIL_SEND) scopes.push(SCOPES.gmailSend);
  if (config.ENABLE_GMAIL_DRAFTS) scopes.push(SCOPES.gmailCompose);
  if (config.ENABLE_DOCS_APPEND) scopes.push(SCOPES.documents);
  return scopes;
}

/**
 * Loopback redirect URI used by the one-time `npm run auth` flow.
 * Google's "Desktop app" OAuth client type allows any localhost port, so we
 * bind the local server before building this so the port is known.
 */
export function loopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}`;
}

let cachedClient: OAuth2Client | undefined;

/**
 * Returns a shared, auto-refreshing OAuth2Client. Throws AuthRequiredError
 * if no token has been stored yet (i.e. `npm run auth` hasn't been run).
 */
export function getAuthorizedClient(config: Config): OAuth2Client {
  if (cachedClient) return cachedClient;

  const client = new OAuth2Client({
    clientId: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
  });

  const tokens = loadTokens(config.GOOGLE_TOKEN_PATH);
  if (!tokens) {
    throw new AuthRequiredError();
  }
  client.setCredentials(tokens);

  client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    try {
      saveTokens(config.GOOGLE_TOKEN_PATH, merged);
    } catch (err) {
      logger.warn("Failed to persist refreshed Google tokens", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  cachedClient = client;
  return client;
}

/** Test/reset helper — clears the module-level client cache. */
export function resetAuthClientCache(): void {
  cachedClient = undefined;
}
