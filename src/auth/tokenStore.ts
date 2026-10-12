import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import type { Credentials } from "google-auth-library";

export function resolveTokenPath(configuredPath: string): string {
  if (configuredPath.startsWith("~")) {
    return configuredPath.replace(/^~/, homedir());
  }
  return configuredPath;
}

export function loadTokens(tokenPath: string): Credentials | undefined {
  const resolved = resolveTokenPath(tokenPath);
  if (!existsSync(resolved)) return undefined;
  const raw = readFileSync(resolved, "utf-8");
  return JSON.parse(raw) as Credentials;
}

export function saveTokens(tokenPath: string, tokens: Credentials): void {
  const resolved = resolveTokenPath(tokenPath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  try {
    chmodSync(resolved, 0o600);
  } catch {
    // best-effort on platforms without POSIX permission bits
  }
}
