import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapTokenFromEnv } from "../../src/auth/bootstrapToken.js";
import { makeTestConfig } from "../testConfig.js";

const dirs: string[] = [];

function freshTokenPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-bootstrap-test-"));
  dirs.push(dir);
  return join(dir, "token.json");
}

afterEach(() => {
  delete process.env.GOOGLE_TOKEN_JSON_B64;
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("bootstrapTokenFromEnv", () => {
  it("writes the decoded token when no file exists and the env var is set", () => {
    const tokenPath = freshTokenPath();
    const tokens = { refresh_token: "rt-123", access_token: "at-456", scope: "https://www.googleapis.com/auth/gmail.send" };
    process.env.GOOGLE_TOKEN_JSON_B64 = Buffer.from(JSON.stringify(tokens)).toString("base64");

    bootstrapTokenFromEnv(makeTestConfig({ GOOGLE_TOKEN_PATH: tokenPath }));

    expect(existsSync(tokenPath)).toBe(true);
    expect(JSON.parse(readFileSync(tokenPath, "utf-8"))).toEqual(tokens);
  });

  it("does nothing when the env var is not set", () => {
    const tokenPath = freshTokenPath();
    bootstrapTokenFromEnv(makeTestConfig({ GOOGLE_TOKEN_PATH: tokenPath }));
    expect(existsSync(tokenPath)).toBe(false);
  });

  it("does not overwrite an existing token file even if the env var is set", () => {
    const tokenPath = freshTokenPath();
    const existing = { refresh_token: "already-here" };
    process.env.GOOGLE_TOKEN_JSON_B64 = Buffer.from(JSON.stringify({ refresh_token: "should-not-be-written" })).toString("base64");

    // Pre-populate the file via the same code path bootstrap itself would use.
    bootstrapTokenFromEnv(makeTestConfig({ GOOGLE_TOKEN_PATH: tokenPath }));
    expect(JSON.parse(readFileSync(tokenPath, "utf-8")).refresh_token).toBe("should-not-be-written");

    process.env.GOOGLE_TOKEN_JSON_B64 = Buffer.from(JSON.stringify(existing)).toString("base64");
    bootstrapTokenFromEnv(makeTestConfig({ GOOGLE_TOKEN_PATH: tokenPath }));

    expect(JSON.parse(readFileSync(tokenPath, "utf-8")).refresh_token).toBe("should-not-be-written");
  });

  it("does not throw when the env var holds invalid base64/JSON", () => {
    const tokenPath = freshTokenPath();
    process.env.GOOGLE_TOKEN_JSON_B64 = "not-valid-base64-json!!!";
    expect(() => bootstrapTokenFromEnv(makeTestConfig({ GOOGLE_TOKEN_PATH: tokenPath }))).not.toThrow();
    expect(existsSync(tokenPath)).toBe(false);
  });
});
