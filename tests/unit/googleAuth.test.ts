import { describe, it, expect } from "vitest";
import { scopesForConfig, loopbackRedirectUri, SCOPES } from "../../src/auth/googleAuth.js";
import { makeTestConfig } from "../testConfig.js";

describe("scopesForConfig", () => {
  it("requests all scopes when all features are enabled", () => {
    const scopes = scopesForConfig(makeTestConfig());
    expect(scopes).toEqual([SCOPES.gmailSend, SCOPES.gmailCompose, SCOPES.documents]);
  });

  it("omits scopes for disabled features", () => {
    const scopes = scopesForConfig(makeTestConfig({ ENABLE_GMAIL_DRAFTS: false, ENABLE_DOCS_APPEND: false }));
    expect(scopes).toEqual([SCOPES.gmailSend]);
  });

  it("returns an empty list when nothing is enabled", () => {
    const scopes = scopesForConfig(
      makeTestConfig({ ENABLE_GMAIL_SEND: false, ENABLE_GMAIL_DRAFTS: false, ENABLE_DOCS_APPEND: false }),
    );
    expect(scopes).toEqual([]);
  });
});

describe("loopbackRedirectUri", () => {
  it("builds a 127.0.0.1 redirect URI for the given port", () => {
    expect(loopbackRedirectUri(53214)).toBe("http://127.0.0.1:53214");
  });
});
