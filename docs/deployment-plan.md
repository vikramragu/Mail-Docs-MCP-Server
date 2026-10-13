# Deployment Plan: google-workspace-mcp on Railway

## Goal

Run this MCP server as a persistent, remotely-reachable HTTPS service on [Railway](https://railway.app), so it can be used as a ChatGPT connector or any other remote MCP client — not just locally over stdio.

Railway runs a long-lived web process and proxies HTTPS traffic to it, so this deployment uses the **Streamable HTTP transport** (`MCP_TRANSPORT=http`), not stdio.

---

## 0. Prerequisite code fixes — ✅ done

Two real gaps existed in the code that only mattered once this server is reachable from outside `127.0.0.1`; local testing never exercised them because it always used `MCP_HTTP_HOST=127.0.0.1`. All three items below are now implemented and covered by tests (`tests/protocol/httpTransport.test.ts`, `tests/unit/bootstrapToken.test.ts`, `tests/unit/config.test.ts`).

### 0.1 Origin-check bug — fixed

`isOriginAllowed` in `src/transports/http.ts` used to compare the request's `Origin` header against `config.MCP_HTTP_HOST` — the address the process *binds* to, not its public hostname. On Railway the process binds to `0.0.0.0`, which no real client's `Origin` header ever matches, so every browser-based client (e.g. a ChatGPT connector) would have gotten a **403 on every request**.

**Implemented fix:** a new `MCP_ALLOWED_ORIGINS` config value (comma-separated, same pattern as `ALLOWED_RECIPIENT_DOMAINS`). When set, the Origin header is checked against this exact allowlist instead of the bind host; when unset, the previous localhost-only behavior remains the default (safe for local `--host 0.0.0.0` testing). See `.env.example` and `README.md`'s Configuration table.

### 0.2 OAuth token bootstrap — implemented

Railway containers are **ephemeral**: anything written to the filesystem at runtime (including `GOOGLE_TOKEN_PATH`) is lost on every redeploy/restart unless it's on a persisted Volume, and `npm run auth`'s interactive browser flow can't run against a headless container.

**Implemented:** `src/auth/bootstrapToken.ts`'s `bootstrapTokenFromEnv(config)`, called once at startup in `src/index.ts` (right after `loadConfig`). If `GOOGLE_TOKEN_PATH` doesn't already exist on disk and `GOOGLE_TOKEN_JSON_B64` is set, it's decoded and written there via the existing `saveTokens` helper; it's a no-op (never overwrites) if a token file is already present. To use it:
1. Run `npm run auth` locally (already done for this project) to produce `~/.config/google-workspace-mcp/token.json`.
2. Base64-encode it: `base64 -i ~/.config/google-workspace-mcp/token.json | pbcopy` (macOS).
3. Set that value as a Railway **secret** env var named `GOOGLE_TOKEN_JSON_B64`.

Google's refresh tokens are long-lived (once out of "Testing" status, or while the account stays a listed test user), and `getAuthorizedClient` already auto-persists refreshed access tokens back to the same path for the life of the container — so re-bootstrapping from the env var on every cold start is harmless and keeps things stateless.

*(Alternative not implemented: a Railway Volume + manually copying `token.json` onto it. Not needed now that option A is in place — only worth revisiting if you have a strong preference against secrets holding token material, which isn't actually more secure, since Railway env vars are encrypted at rest and access-controlled the same way a Volume would be.)*

### 0.3 Health-check endpoint — implemented

`GET /healthz` now returns `200` unauthenticated (registered in `buildHttpApp` before the Origin/bearer-auth guards), so Railway's health check doesn't need the bearer token and doesn't hit the `405` that a naive check against `/mcp` would (that route still correctly returns `405` for `GET`, by design — stateless mode has no server-initiated stream).

---

## 1. Prerequisites checklist

- [x] §0.1 Origin-check fix merged
- [x] §0.2 Token bootstrap strategy implemented (Option A)
- [x] §0.3 Health check implemented (`GET /healthz`)
- [ ] A Railway account, with the GitHub repo for this project pushed (Railway deploys from a connected GitHub repo or via `railway up` from the CLI)
- [ ] Your Google Cloud OAuth **Desktop app** client ID/secret (already created and working locally)
- [ ] A strong random value generated for `MCP_AUTH_TOKEN`, e.g. `openssl rand -hex 32`

---

## 2. Create the Railway project

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → select this repo.
   - Alternative: install the Railway CLI (`npm i -g @railway/cli`), `railway login`, `railway init`, `railway up` from this directory.
2. Railway auto-detects Node.js via Nixpacks — no Dockerfile needed. It will run `npm install` then (since `package.json` has a `build` script) `npm run build` automatically during the build phase.
3. Under the service's **Settings → Deploy**, set a custom **Start Command** (overriding the default `npm start`), because Railway's `$PORT` and the 0.0.0.0 bind need to be threaded through as environment variables for this one process invocation:

   ```
   sh -c "MCP_TRANSPORT=http MCP_HTTP_HOST=0.0.0.0 MCP_HTTP_PORT=$PORT node dist/index.js"
   ```

   This avoids needing any code change for port binding — Railway injects `PORT` automatically, and this command line maps it onto this app's own `MCP_HTTP_PORT` variable at launch.

---

## 3. Environment variables (Railway → service → Variables)

| Variable | Value | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | *(from Google Cloud)* | same Desktop-app client already working locally |
| `GOOGLE_CLIENT_SECRET` | *(from Google Cloud)* | mark as a Railway **secret** |
| `GOOGLE_TOKEN_PATH` | `/root/.config/google-workspace-mcp/token.json` (or a Volume path, see §0.2B) | |
| `GOOGLE_TOKEN_JSON_B64` | *(base64 of your local token.json)* | only if using §0.2 Option A; mark as secret |
| `ENABLE_GMAIL_SEND` / `ENABLE_GMAIL_DRAFTS` / `ENABLE_DOCS_APPEND` | `true` (or per your needs) | |
| `DRY_RUN` | `false` once verified, `true` for an initial smoke test | start with `true` the first deploy |
| `ALLOWED_RECIPIENT_DOMAINS` | your domain(s), or leave empty | strongly recommended to set this for a public-facing deployment |
| `MAX_RECIPIENTS` / `MAX_ATTACHMENT_MB` | defaults are fine | |
| `ALLOWED_DOCUMENT_IDS` | optional | |
| `MCP_AUTH_TOKEN` | the `openssl rand -hex 32` value from §1 | **required** — the server refuses to start over HTTP without it; mark as secret |
| `MCP_ALLOWED_ORIGINS` | `https://<your-app>.up.railway.app` (once known) | from the §0.1 fix; add your ChatGPT connector's expected origin if different |
| `LOG_LEVEL` | `info` | |

Do **not** set `MCP_TRANSPORT`, `MCP_HTTP_HOST`, or `MCP_HTTP_PORT` as Variables — those are supplied inline by the Start Command in §2 so `$PORT` expansion works correctly.

---

## 4. Networking & HTTPS

- Railway gives every service a free `*.up.railway.app` HTTPS domain automatically (satisfies problemStatement.md §8.2's "HTTPS required for any non-localhost deployment" — TLS is terminated by Railway's edge, no reverse proxy setup needed on your side).
- A custom domain can be attached later under **Settings → Networking → Domains** if desired.
- The final MCP endpoint will be: `https://<your-app>.up.railway.app/mcp`

---

## 5. Post-deploy verification

Mirror the local curl checks we ran against `127.0.0.1`, against the live Railway URL:

```bash
BASE=https://<your-app>.up.railway.app
TOKEN=<your MCP_AUTH_TOKEN>

# No token -> expect 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Valid token -> expect 200 with tools/list
curl -s -X POST "$BASE/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}'

curl -s -X POST "$BASE/mcp" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/list"}'
```

Expect: `401` with no token, and `200` responses listing all 5 tools with the real token. Do this first with `DRY_RUN=true`, confirm a `gmail_send_email` dry-run call behaves correctly against the live deployment, **then** flip `DRY_RUN=false` for real use.

---

## 6. Connect a remote MCP client (e.g. ChatGPT)

Per `README.md` §"ChatGPT": add a custom connector (developer mode) pointing at `https://<your-app>.up.railway.app/mcp` with the bearer token from `MCP_AUTH_TOKEN`.

---

## 7. Ongoing operations

- **Rotating `MCP_AUTH_TOKEN`**: generate a new value, update the Railway variable, redeploy, update it in any connected clients.
- **Logs**: Railway's service **Logs** tab streams stderr/stdout — this server writes structured JSON logs (including the audit trail) to stderr only, so they'll show up there cleanly.
- **Redeploys**: pushing to the connected GitHub branch (or `railway up`) triggers a new build/deploy automatically. The OAuth token bootstrap in §0.2A re-runs on every cold start, so redeploys don't lose authorization.
- **Scaling/idling**: this server is intentionally stateless per HTTP request (fresh `McpServer` + transport per call, no in-memory session), so it tolerates Railway's cold starts and horizontal scaling without any special handling.
- **Cost**: Railway's free/Hobby tier has usage limits — check current pricing before leaving this running long-term with real traffic.

---

## Status

Phase 0 (§0.1–§0.3) is implemented, tested (115 tests passing, including dedicated coverage for the origin allowlist, health check, and token bootstrap), and typechecked. What's left is §1–§7: provisioning the actual Railway project, setting its environment variables, and running the post-deploy verification.
