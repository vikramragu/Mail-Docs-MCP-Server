#!/usr/bin/env node
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { URL } from "node:url";
import { OAuth2Client } from "google-auth-library";
import { loadConfig } from "../config.js";
import { scopesForConfig, loopbackRedirectUri } from "./googleAuth.js";
import { saveTokens, resolveTokenPath } from "./tokenStore.js";

function openBrowser(url: string): void {
  const platform = process.platform;
  const command = platform === "darwin" ? `open "${url}"` : platform === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(command, (err) => {
    if (err) {
      console.error(`Could not open a browser automatically. Please open this URL manually:\n${url}`);
    }
  });
}

/**
 * One-time interactive OAuth flow: starts a loopback HTTP server, opens the
 * consent screen in the user's browser, exchanges the returned code for
 * tokens, and persists them. Run via `npm run auth`.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const scopes = scopesForConfig(config);
  if (scopes.length === 0) {
    console.error("No features enabled (ENABLE_GMAIL_SEND / ENABLE_GMAIL_DRAFTS / ENABLE_DOCS_APPEND are all false). Nothing to authorize.");
    process.exit(1);
  }

  const { redirectUri, code } = await new Promise<{ redirectUri: string; code: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      if (!req.url) return;
      const url = new URL(req.url, "http://127.0.0.1");
      const authCode = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(`Authorization failed: ${error}. You can close this tab.`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }
      if (!authCode) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing authorization code.");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("Authorization complete. You can close this tab and return to the terminal.");
      server.close();

      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ redirectUri: loopbackRedirectUri(port), code: authCode });
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const redirectUri = loopbackRedirectUri(port);

      const client = new OAuth2Client({
        clientId: config.GOOGLE_CLIENT_ID,
        clientSecret: config.GOOGLE_CLIENT_SECRET,
        redirectUri,
      });
      const authUrl = client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: scopes,
      });

      console.error("Opening browser for Google authorization...");
      console.error(`If it doesn't open automatically, visit:\n${authUrl}\n`);
      openBrowser(authUrl);
    });

    server.on("error", reject);
  });

  const client = new OAuth2Client({
    clientId: config.GOOGLE_CLIENT_ID,
    clientSecret: config.GOOGLE_CLIENT_SECRET,
    redirectUri,
  });
  const { tokens } = await client.getToken(code);

  saveTokens(config.GOOGLE_TOKEN_PATH, tokens);
  console.error(`Authorization complete. Refresh token saved to ${resolveTokenPath(config.GOOGLE_TOKEN_PATH)}`);
}

main().catch((err) => {
  console.error("Authorization failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
