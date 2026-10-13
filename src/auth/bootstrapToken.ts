import type { Config } from "../config.js";
import { logger } from "../logger.js";
import { saveTokens, tokenFileExists } from "./tokenStore.js";

/**
 * On an ephemeral host (e.g. Railway) the token file written by
 * `npm run auth` doesn't survive a redeploy, and there's no browser session
 * to re-run that interactive flow against a headless container. If
 * GOOGLE_TOKEN_JSON_B64 is set (a base64-encoded copy of a token.json
 * produced locally) and no token file exists yet at GOOGLE_TOKEN_PATH, this
 * decodes and writes it once at startup so OAuth survives redeploys without
 * needing a persistent volume. A no-op when a token file already exists or
 * the env var isn't set — never overwrites a token already being refreshed
 * in place.
 */
export function bootstrapTokenFromEnv(config: Config): void {
  if (tokenFileExists(config.GOOGLE_TOKEN_PATH)) return;

  const encoded = process.env.GOOGLE_TOKEN_JSON_B64;
  if (!encoded) return;

  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf-8");
    const tokens = JSON.parse(decoded);
    saveTokens(config.GOOGLE_TOKEN_PATH, tokens);
    logger.info("Bootstrapped Google OAuth token from GOOGLE_TOKEN_JSON_B64");
  } catch (err) {
    logger.warn("Failed to bootstrap Google OAuth token from GOOGLE_TOKEN_JSON_B64", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
